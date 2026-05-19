import { Hono } from "hono";
import type { DeviceReport, RunContext } from "../plugin/plugin.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Slot, SlotDisplay } from "../slot/slot.ts";
import type { RenderTrace, Telemetry } from "../telemetry/telemetry.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";

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
  friendlyId: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

export type Conductor = {
  app: Hono;
};

export function createConductor(deps: ConductorDeps): Conductor {
  let latestDevice: DeviceReport | null = null;
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
    let image: Promise<Uint8Array>;
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
    // duration is real wall-clock. The trailing `.catch(noop)` is essential:
    // `.finally` re-throws upstream rejection on the chain we create here,
    // and that chain is otherwise dangling. The `image` promise the Slot
    // stores keeps its rejection; the /image/<id>.png handler observes it.
    image
      .finally(() => {
        const trace: RenderTrace = {
          ranAt,
          identity,
          durations: {
            pluginRun: pluginRunEnd.since(pluginRunStart),
            identity: identityEnd.since(pluginRunEnd),
            rasterize: deps.now().since(identityEnd),
          },
          error: caught,
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
    const ctx: RunContext = { t: deps.now(), intent, device: latestDevice };
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
        image_url: `${publicOrigin(c)}/image/setup.png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) latestDevice = report;
      const display = await ensureDisplay("poll");
      const refreshRate = Math.max(
        1,
        Math.ceil(display.refreshIn.total({ unit: "seconds" })),
      );
      return c.json({
        status: 0,
        image_url: `${publicOrigin(c)}/image/${display.identity}.png`,
        filename: `image-${display.identity}`,
        refresh_rate: refreshRate,
        reset_firmware: false,
        update_firmware: false,
        firmware_url: "",
        special_function: "none",
        maximum_compatibility: true,
      });
    })
    .get("/image/:id{.+\\.png}", async (c) => {
      const param = c.req.param("id");
      const id = param.replace(/\.png$/, "");
      const bytes = await deps.slot.image(id);
      if (bytes === null) return c.notFound();
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.onDeviceLog?.(id, body);
      return c.body(null, 204);
    });

  return { app };
}
