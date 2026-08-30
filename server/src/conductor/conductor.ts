import { Hono } from "hono";
import { greaterThan, tryParse } from "@std/semver";
import type { DeviceReport, RunContext } from "../plugin/plugin.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Slot, SlotDisplay } from "../slot/slot.ts";
import type { RenderTrace, Telemetry } from "../telemetry/telemetry.ts";
import type { DeviceState } from "../device-state.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import type { Clock } from "../clock.ts";
import { latestOfficialFirmware } from "../firmware/firmware.ts";

// BYOS facade. Owns the orchestration loop from `/api/display` through
// Plugin → identity → eager rasterize → Slot.put, and serves the PNG at
// `/image/<identity>.png`. See ADR-0003 (pipeline) and ADR-0004 (three-tier
// cache + error fallback).

export type ConductorDeps = {
  pluginManager: PluginManager;
  renderer: Renderer;
  slot: Slot;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  telemetry: Telemetry;
  deviceState: DeviceState;
  friendlyId: string;
  // Empty → derive the origin the Device dialled from its own request headers.
  publicUrlOrigin: string;
  now: Clock;
  // true → check TRMNL's official firmware bucket on every poll and offer an
  // update when the Device is behind. See SystemConfig.firmwareAutoUpdate.
  firmwareAutoUpdate?: boolean;
  fetch?: typeof fetch;
};

export type Conductor = {
  app: Hono;
};

export function createConductor(deps: ConductorDeps): Conductor {
  const fetchImpl = deps.fetch ?? fetch;

  // Single-flight: a cache miss runs the Plugin at most once even under
  // burst load (Device poll racing the Dashboard's in-process refill).
  let pendingRefill: Promise<void> | null = null;

  function errorResult(error: Error) {
    return {
      state: error,
      validity: deps.errorValidity,
      view: deps.errorView,
    };
  }

  async function doRefill(ctx: RunContext): Promise<void> {
    const pluginRunStart = deps.now();
    const ranAt = pluginRunStart;
    let pluginRunEnd = pluginRunStart;
    let identityEnd = pluginRunStart;
    let caught: Error | null = null;
    let bundle: Bundle;
    let identity: string;
    let image: Promise<Uint8Array<ArrayBuffer>>;
    try {
      bundle = await deps.pluginManager.run(ctx);
      pluginRunEnd = deps.now();
      identity = await deps.renderer.identity(bundle);
      identityEnd = deps.now();
      image = deps.renderer.rasterize(bundle);
    } catch (err) {
      // Error path: re-enter the same loop with a fabricated error Bundle
      // (ADR-0003). Empty assets — error view renders self-contained HTML.
      caught = err instanceof Error ? err : new Error(String(err));
      pluginRunEnd = deps.now();
      bundle = { result: errorResult(caught), assets: {} };
      identity = await deps.renderer.identity(bundle);
      identityEnd = deps.now();
      image = deps.renderer.rasterize(bundle);
    }
    // Record telemetry once the eager rasterize settles, so `rasterize`
    // duration is real wall-clock. The two-armed `.then` maps a resolve to
    // `null` and normalizes a reject into an Error, so an asynchronous
    // rasterize failure (CDP outage, dither failure) lands in
    // `trace.error` exactly like a synchronous one. Because that first
    // `.then` never itself throws, the chain we create here never produces
    // an unhandled rejection; the trailing `.catch(noop)` only guards
    // against `telemetry.record` throwing. The `image` promise the Slot
    // stores keeps its original rejection — the /image/<id>.png handler
    // still observes it.
    image
      .then(
        () => null,
        (err) => (err instanceof Error ? err : new Error(String(err))),
      )
      .then((rasterizeError) => {
        const trace: RenderTrace = {
          ranAt,
          identity,
          durations: {
            pluginRun: pluginRunEnd.since(pluginRunStart),
            identity: identityEnd.since(pluginRunEnd),
            rasterize: deps.now().since(identityEnd),
          },
          error: caught ?? rasterizeError,
        };
        deps.telemetry.record(trace);
      })
      .catch(() => {});
    deps.slot.put({
      bundle,
      identity,
      image,
      cachedAt: deps.now(),
    });
  }

  function refillSlot(ctx: RunContext): Promise<void> {
    if (pendingRefill !== null) return pendingRefill;
    pendingRefill = doRefill(ctx).finally(() => {
      pendingRefill = null;
    });
    return pendingRefill;
  }

  async function ensureDisplay(intent: RunContext["intent"]): Promise<SlotDisplay> {
    const cached = deps.slot.display();
    if (cached !== null) return cached;
    const ctx: RunContext = {
      t: deps.now(),
      intent,
      device: deps.deviceState.latestDevice(),
    };
    await refillSlot(ctx);
    const display = deps.slot.display();
    if (display === null) {
      throw new Error("Slot empty after refill — bundle validity must be > 0");
    }
    return display;
  }

  const app = new Hono()
    .get("/api/setup", (c) =>
      // `image_url` is a placeholder — firmware proceeds to /api/display
      // immediately, which returns the real identity-keyed URL.
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c, deps.publicUrlOrigin)}/image/setup.png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) {
        // Capture the full Headers entries alongside the parsed report so
        // the dashboard can surface anything firmware sent that we don't
        // model yet (User-Agent, Access-Token, future headers, …).
        const rawHeaders = [...c.req.raw.headers.entries()];
        deps.deviceState.reportDevice(report, rawHeaders);
      }
      const display = await ensureDisplay("poll");
      const refreshRate = Math.max(
        1,
        Math.ceil(display.refreshIn.total({ unit: "seconds" })),
      );
      const firmwareUpdate = deps.firmwareAutoUpdate
        ? await pendingFirmwareUpdate(deps.deviceState.latestDevice(), fetchImpl)
        : null;
      return c.json({
        status: 0,
        image_url: `${publicOrigin(c, deps.publicUrlOrigin)}/image/${display.identity}.png`,
        filename: `image-${display.identity}`,
        refresh_rate: refreshRate,
        reset_firmware: false,
        update_firmware: firmwareUpdate !== null,
        firmware_url: firmwareUpdate?.url ?? "",
        special_function: "none",
        // "a" forces CLEAR_SLOW on TRMNL X's FastEPD path (4-pass B/W/B/W
        // ghost-erase vs CLEAR_FAST's 2-pass), eliminating visible ghosting
        // on dense imagery. Per-refresh cost is negligible at our cadence,
        // so it's hardcoded rather than driven per-Plugin via Result.hints.
        // See firmware PR usetrmnl/trmnl-firmware#357 + the `iTempProfile > 0`
        // branch at display.cpp:1738. `maximum_compatibility` is intentionally
        // absent — FastEPD ignores it (only honored on BB_EPAPER hardware).
        temperature_profile: "a",
      });
    })
    .get("/image/:id{.+\\.png}", async (c) => {
      const param = c.req.param("id");
      const id = param.replace(/\.png$/, "");
      const bytes = await deps.slot.image(id);
      if (bytes === null) return c.notFound();
      return c.body(bytes, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.deviceState.appendLog(id, body);
      return c.body(null, 204);
    });

  return { app };
}

// null unless the Device has reported both a model and a parseable firmware
// version, TRMNL's bucket has a release for that model, and the Device's
// version is older than it — i.e. exactly when offering an update makes sense.
async function pendingFirmwareUpdate(
  device: DeviceReport | null,
  fetchImpl: typeof fetch,
) {
  const reported = tryParse(device?.fwVersion ?? "");
  if (device?.model == null || reported === undefined) return null;
  const latest = await latestOfficialFirmware(device.model, fetchImpl);
  if (latest === null) return null;
  return greaterThan(latest.version, reported) ? latest : null;
}
