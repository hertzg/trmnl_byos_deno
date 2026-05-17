import { Hono } from "hono";
import type { DeviceReport, Result, RunContext } from "../plugin/plugin.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import { timed } from "../render/timings.ts";

// The Conductor is opaque to the Plugin's state shape. The PluginManager
// produces a Bundle (`{ result, assets }`) that the Renderer consumes for
// identity (and, in later slices, rasterize). The Conductor itself never
// touches the raw Plugin module — `pluginManager.run(ctx)` is the only seam.

export type ConductorDeps = {
  // Loaded once at boot; reused across calls. Captures the Plugin module +
  // its on-disk assets folder. See src/plugin/plugin-manager.ts.
  pluginManager: PluginManager;
  // The Renderer owns Bundle → identity (and, when the slot path lands,
  // Bundle → Image). Conductor only calls `renderer.identity(bundle)` here;
  // the Device-facing pixels still come from /preview/png on the Dashboard
  // sub-app for this slice.
  renderer: Renderer;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  // BYOS surface — these flow through the Conductor's own Hono sub-app.
  friendlyId: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

// `derive()` output: pipeline up to Bundle and identity. The Conductor has
// no rasterize step anymore — peers that want pixels screenshot /preview
// via the dashboard's `fetchPngFromUrl`. `device` is the DeviceReport the
// Plugin actually saw on `ctx.device` (latest report at the time of the
// call, or null if no Device has polled yet). `error` is non-null when the
// Plugin or Renderer.identity threw and the bundle/identity reflect the
// error-view fallback.
export type DeriveResult = {
  result: Result<unknown>;
  // The Bundle the Renderer saw. PluginManager owns this — its `assets`
  // map carries the Plugin's on-disk asset bytes loaded once at boot.
  bundle: Bundle;
  identity: string;
  device: DeviceReport | null;
  error: Error | null;
};

export type Conductor = {
  // Hono sub-app for the BYOS surface (/api/setup, /api/display, /api/log).
  // No /assets/* route — Plugin assets travel through Bundle into Renderer's
  // loopback origin (ADR-0003, ADR-0005, slice #51).
  app: Hono;
  // Run Plugin + Renderer.identity at an arbitrary `t`. Used by /preview
  // (whose HTML CDP screenshots) and the dashboard.
  derive(
    t: Temporal.ZonedDateTime,
    intent?: RunContext["intent"],
  ): Promise<DeriveResult>;
};

// The orchestration logic lives entirely inside the factory closure;
// peers reach it via the small `derive` surface.
export function createConductor(deps: ConductorDeps): Conductor {
  let latestDevice: DeviceReport | null = null;

  // Wrap an error in the Server-supplied error view as a Result. Any failure
  // inside `derive` (plugin.run, Renderer.identity) falls back to this
  // shape with the configured short validity.
  function errorResult(err: unknown): Result<unknown> {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      state: error,
      validity: deps.errorValidity,
      view: deps.errorView,
    };
  }

  // Each pipeline step is wrapped in `timed()` so callers that open a
  // `withTimings()` context around the call get per-step wall-clock for
  // free. Outside such a context `timed()` is a pass-through.
  async function runAndDerive(input: {
    t: Temporal.ZonedDateTime;
    intent: RunContext["intent"];
  }): Promise<DeriveResult> {
    const ctx: RunContext = {
      t: input.t,
      intent: input.intent,
      device: latestDevice,
    };
    let result: Result<unknown>;
    let bundle: Bundle;
    let identity: string;
    let error: Error | null = null;
    try {
      // PluginManager returns a Bundle (`{ result, assets }`); the Renderer
      // consumes the full Bundle for identity. Slot + Renderer.rasterize
      // will consume the Bundle's `assets` in subsequent slices.
      bundle = await timed("pipeline.run", () => deps.pluginManager.run(ctx));
      result = bundle.result;
      identity = await timed(
        "pipeline.identity",
        () => Promise.resolve(deps.renderer.identity(bundle)),
      );
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      result = errorResult(err);
      // For the error path the asset map is irrelevant — the error view
      // renders its own self-contained HTML — so we hand the Renderer the
      // error Result with an empty `assets` map.
      bundle = { result, assets: {} };
      identity = await timed(
        "pipeline.identity",
        () => Promise.resolve(deps.renderer.identity(bundle)),
      );
    }
    return { result, bundle, identity, device: ctx.device, error };
  }

  async function derive(
    t: Temporal.ZonedDateTime,
    intent: RunContext["intent"] = "scrub",
  ): Promise<DeriveResult> {
    return await runAndDerive({ t, intent });
  }

  const app = new Hono()
    .get("/api/setup", (c) =>
      // `image_url` is part of the BYOS setup payload. The Device proceeds
      // to /api/display next, which returns the same URL. Kept here because
      // the BYOS firmware expects the field to be present.
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/preview/png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      // Record the Device's heartbeat so the next Plugin run (the one CDP
      // triggers via /preview when the Device fetches image_url) sees it on
      // ctx.device.
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) latestDevice = report;
      // Run the Plugin once here just to compute (refresh_rate, filename).
      // The actual pixels come from a separate /preview/png fetch the Device
      // makes next — that fetch runs the Plugin a second time via CDP. Two
      // runs per Device cycle is the cost of dropping the cache; for
      // typical refresh rates (minutes), it's fine.
      const now = deps.now();
      const { result, identity } = await runAndDerive({ t: now, intent: "poll" });
      const refreshRate = Math.max(
        1,
        Math.ceil(result.validity.total({ unit: "seconds" })),
      );
      return c.json({
        status: 0,
        image_url: `${publicOrigin(c)}/preview/png`,
        filename: `image-${identity}`,
        refresh_rate: refreshRate,
        reset_firmware: false,
        update_firmware: false,
        firmware_url: "",
        special_function: "none",
        maximum_compatibility: true,
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.onDeviceLog?.(id, body);
      return c.body(null, 204);
    });

  return { app, derive };
}
