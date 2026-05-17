import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import type { DeviceReport, Plugin, Result, RunContext } from "../plugin/plugin.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import { timed } from "../render/timings.ts";

// The Conductor is opaque to the Plugin's state shape. `Result<unknown>` /
// `Plugin<unknown>` work here because `Result.view` is declared as a method
// in the contract (see src/plugin/plugin.ts), which makes the type
// bivariant in `S` — a Plugin author's `Plugin<MyState>` flows in cleanly,
// keeping full type safety inside `run` and `view`.

export type ConductorDeps = {
  plugin: Plugin<unknown>;
  // The pure HTML-derivation half of the Renderer. Rasterize lives on the
  // dashboard side now — the Conductor no longer turns HTML into PNGs; the
  // Device fetches `/preview/png`, which screenshots `/preview` live.
  deriveHtml(result: Result<unknown>): string | Promise<string>;
  // Hash of the HTML used as the Image's stable identity, exposed to the
  // Device via the `filename` field on `/api/display`. The firmware skips an
  // e-ink refresh when the filename matches its last frame, so the identity
  // is the only handle we have on cross-poll dedupe.
  identityFor: (html: string) => string | Promise<string>;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  // BYOS surface — these flow through the Conductor's own Hono sub-app.
  friendlyId: string;
  pluginAssetsDir: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

// `derive()` output: pipeline up to HTML and identity. The Conductor has no
// rasterize step anymore — peers that want pixels screenshot `/preview` via
// the dashboard's `fetchPngFromUrl`. `device` is the DeviceReport the Plugin
// actually saw on `ctx.device` (latest report at the time of the call, or
// null if no Device has polled yet). `error` is non-null when the Plugin /
// deriveHtml / identityFor threw and the result/html/identity reflect the
// error-view fallback.
export type DeriveResult = {
  result: Result<unknown>;
  html: string;
  identity: string;
  device: DeviceReport | null;
  error: Error | null;
};

export type Conductor = {
  // Hono sub-app for the BYOS surface (/api/setup, /api/display, /api/log)
  // and Plugin assets (/assets/*).
  app: Hono;
  // Run Plugin + deriveHtml + identityFor at an arbitrary `t`. Used by
  // `/preview` (HTML for CDP to screenshot) and the dashboard.
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
  // inside `derive` (plugin.run, deriveHtml, identityFor) falls back to this
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
    let html: string;
    let identity: string;
    let error: Error | null = null;
    try {
      result = await timed("pipeline.run", () => Promise.resolve(deps.plugin.run(ctx)));
      html = await timed(
        "pipeline.deriveHtml",
        () => Promise.resolve(deps.deriveHtml(result)),
      );
      identity = await timed(
        "pipeline.identityFor",
        () => Promise.resolve(deps.identityFor(html)),
      );
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      result = errorResult(err);
      html = await timed(
        "pipeline.deriveHtml",
        () => Promise.resolve(deps.deriveHtml(result)),
      );
      identity = await timed(
        "pipeline.identityFor",
        () => Promise.resolve(deps.identityFor(html)),
      );
    }
    return { result, html, identity, device: ctx.device, error };
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
    })
    // serveStatic appends the full request path to `root` (it doesn't strip
    // the matched URL prefix), so we rewrite `/assets/foo.css` → `/foo.css`
    // before lookup. That way `pluginAssetsDir` honestly points at the dir
    // that contains the files, not at its parent.
    .use(
      "/assets/*",
      serveStatic({
        root: deps.pluginAssetsDir,
        rewriteRequestPath: (path) => path.replace(/^\/assets/, ""),
      }),
    );

  return { app, derive };
}
