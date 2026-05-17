import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import type { DeviceReport, Plugin, Result, RunContext } from "../plugin/plugin.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import { withTimings } from "../render/timings.ts";

// The Conductor is opaque to the Plugin's state shape. `Result<unknown>` /
// `Plugin<unknown>` work here because `Result.view` is declared as a method
// in the contract (see src/plugin/plugin.ts), which makes the type
// bivariant in `S` — a Plugin author's `Plugin<MyState>` flows in cleanly,
// keeping full type safety inside `run` and `view`.
export type RendererDep = {
  deriveHtml(result: Result<unknown>): string | Promise<string>;
  rasterize(html: string, hints?: Record<string, unknown>): Promise<Uint8Array>;
};

export type ConductorDeps = {
  plugin: Plugin<unknown>;
  renderer: RendererDep;
  identityFor: (html: string) => string | Promise<string>;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  // BYOS surface — these flow through the Conductor's own Hono sub-app.
  friendlyId: string;
  pluginAssetsDir: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

// Per-step wall-clock durations from a scrub, in milliseconds. Each field
// is the cumulative time spent in that step across the run — including any
// error-fallback retries (e.g. if rasterize threw, the subsequent retry
// against the error view's HTML adds to `deriveHtml` / `identityFor` /
// `rasterize`). `total` is the wall-clock for the whole scrub call.
//
// `rasterizeSubSteps` is populated by whatever the renderer instruments
// via `src/render/timings.ts` (CDP connect / navigate / screenshot,
// dither decode / kernel / encode, etc.). The dashboard renders these
// as a second proportional bar so the operator can see what dominates
// the (typically expensive) rasterize step. Empty when the renderer's
// implementation doesn't call `timed()` — the type accepts that and
// the dashboard hides the breakdown row.
export type ScrubTimings = {
  run: number;
  deriveHtml: number;
  identityFor: number;
  rasterize: number;
  rasterizeSubSteps: Record<string, number>;
  total: number;
};

// Scrub output: what the dashboard (or any peer that wants to drive
// the Plugin at an arbitrary `t`) receives. Post error-fallback — if
// any pipeline step threw, the swapped-in error Result/identity/png
// is what flows out. `device` is the DeviceReport the Plugin actually
// saw on its `ctx.device` (latest report at scrub time, or null if no
// Device has polled yet).
export type ScrubResult = {
  result: Result<unknown>;
  identity: string;
  png: Uint8Array;
  device: DeviceReport | null;
  timings: ScrubTimings;
};

// Committed state: what the Device is currently being served by the
// poll path. Null until the first poll has populated Current Result +
// Current Image. `device` is the DeviceReport captured at commit time
// (the Plugin's `ctx.device` for the run that produced this state).
export type CommittedState = {
  t: Temporal.ZonedDateTime;
  result: Result<unknown>;
  identity: string;
  device: DeviceReport | null;
} | null;

// Derive output: HTML and identity at an arbitrary `t` without rasterizing.
// Used by peers (e.g. the dashboard's /preview route) that want the live
// HTML for inspection without paying CDP cost.
export type DeriveResult = {
  result: Result<unknown>;
  html: string;
  identity: string;
  device: DeviceReport | null;
};

export type Conductor = {
  // Hono sub-app for the BYOS surface (/api/setup, /api/display, /api/log,
  // /images/:identity/png) and Plugin assets (/assets/*).
  app: Hono;
  // Run Plugin + deriveHtml + identityFor at an arbitrary `t` with
  // intent: "scrub". Skips rasterize — useful for cheap dev-iteration
  // surfaces that only need the HTML. Never mutates Current state.
  derive(t: Temporal.ZonedDateTime): Promise<DeriveResult>;
  // Full pipeline at an arbitrary `t`: derive + rasterize, with per-step
  // timings. Always rasterizes (never short-circuits via identity match).
  // Never mutates Current state.
  scrub(t: Temporal.ZonedDateTime): Promise<ScrubResult>;
  // Latest committed Result + Image, or null pre-first-poll. Peers read
  // this to surface "what the Device is seeing right now".
  committedState(): CommittedState;
};

// The orchestration logic lives entirely inside the factory closure;
// peers reach it via the small `scrub` + `committedState` surface.
export function createConductor(deps: ConductorDeps): Conductor {
  type CurrentResult = { ctx: RunContext; result: Result<unknown> };
  type CurrentImage = { png: Uint8Array; identity: string };

  let currentResult: CurrentResult | null = null;
  let currentImage: CurrentImage | null = null;
  let latestDevice: DeviceReport | null = null;

  // Wrap an error in the Server-supplied error view as a Result. Per
  // ADR-0003, any failure inside the pipeline (plugin.run, deriveHtml, or
  // rasterize) falls back to this shape with the configured short validity.
  function errorResult(err: unknown): Result<unknown> {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      state: error,
      validity: deps.errorValidity,
      view: deps.errorView,
    };
  }

  // Pipeline up to identity, with error-view fallback for plugin.run +
  // deriveHtml + identityFor. No state mutation — callers decide whether
  // to update Current Result / Current Image. Rasterize is separate
  // (handled by the rasterize-with-fallback in callers below).
  async function runAndDerive(input: {
    t: Temporal.ZonedDateTime;
    intent: "poll" | "scrub" | "prerender";
  }) {
    const ctx: RunContext = {
      t: input.t,
      intent: input.intent,
      device: latestDevice,
    };
    let result: Result<unknown>;
    let html: string;
    let identity: string;
    try {
      result = await deps.plugin.run(ctx);
      html = await deps.renderer.deriveHtml(result);
      identity = await deps.identityFor(html);
    } catch (err) {
      result = errorResult(err);
      html = await deps.renderer.deriveHtml(result);
      identity = await deps.identityFor(html);
    }
    return { ctx, result, html, identity };
  }

  // Rasterize with one retry through the error view on failure. If the
  // error view itself fails to rasterize, the exception propagates (better
  // a 500 than an infinite loop). Returns the (possibly-replaced) result/
  // html/identity alongside the PNG so callers can update Current state
  // with the actual rendered Result.
  async function rasterizeWithFallback(
    result: Result<unknown>,
    html: string,
    identity: string,
  ): Promise<{ result: Result<unknown>; html: string; identity: string; png: Uint8Array }> {
    try {
      const png = await deps.renderer.rasterize(html, result.hints);
      return { result, html, identity, png };
    } catch (err) {
      const fallback = errorResult(err);
      const fallbackHtml = await deps.renderer.deriveHtml(fallback);
      const fallbackIdentity = await deps.identityFor(fallbackHtml);
      const png = await deps.renderer.rasterize(fallbackHtml, fallback.hints);
      return { result: fallback, html: fallbackHtml, identity: fallbackIdentity, png };
    }
  }

  // Poll path: validity-window reuse, identity-gated rasterize, and
  // state mutation. Only called from /api/display.
  async function trigger(input: {
    t: Temporal.ZonedDateTime;
    intent: "poll";
  }): Promise<{ png: Uint8Array; identity: string; expiresAt: Temporal.ZonedDateTime }> {
    if (currentResult && currentImage) {
      const currentExpiry = currentResult.ctx.t.add(currentResult.result.validity);
      if (Temporal.ZonedDateTime.compare(input.t, currentExpiry) < 0) {
        return {
          png: currentImage.png,
          identity: currentImage.identity,
          expiresAt: currentExpiry,
        };
      }
    }
    let { ctx, result, html, identity } = await runAndDerive(input);
    if (currentImage?.identity !== identity) {
      const out = await rasterizeWithFallback(result, html, identity);
      // rasterize-with-fallback may have swapped to the error result; honor it.
      result = out.result;
      html = out.html;
      identity = out.identity;
      currentImage = { png: out.png, identity };
    }
    currentResult = { ctx, result };
    return {
      png: currentImage.png,
      identity: currentImage.identity,
      expiresAt: ctx.t.add(result.validity),
    };
  }

  // Scrub the Plugin at an arbitrary `t`. Pure with respect to Current
  // state; the caller decides how to surface the result.
  //
  // Deliberately always rasterizes — even when the scrub's identity
  // matches the Current Image's identity. The poll path short-circuits
  // (it serves the same bytes the Device cached); the dashboard wants
  // a fresh render so it can expose non-deterministic views (and the
  // CDP cost is on the operator, not the Device).
  //
  // The pipeline is inlined here (rather than reusing runAndDerive +
  // rasterizeWithFallback) so we can capture per-step wall-clock for
  // the dashboard's timings strip. Error-fallback retries fold into
  // the corresponding step's total.
  async function scrub(t: Temporal.ZonedDateTime): Promise<ScrubResult> {
    const t0 = performance.now();
    const timings: ScrubTimings = {
      run: 0,
      deriveHtml: 0,
      identityFor: 0,
      rasterize: 0,
      rasterizeSubSteps: {},
      total: 0,
    };
    const ctx: RunContext = { t, intent: "scrub", device: latestDevice };

    async function derive(r: Result<unknown>) {
      const tD = performance.now();
      const html = await deps.renderer.deriveHtml(r);
      timings.deriveHtml += performance.now() - tD;
      const tI = performance.now();
      const identity = await deps.identityFor(html);
      timings.identityFor += performance.now() - tI;
      return { html, identity };
    }

    // Rasterize-with-collector. Sub-step timings flow up through
    // AsyncLocalStorage (see src/render/timings.ts); accumulate into
    // rasterizeSubSteps in case error-fallback fires and we rasterize twice.
    async function rasterizeTimed(r: Result<unknown>, h: string): Promise<Uint8Array> {
      const tRas = performance.now();
      const out = await withTimings(() => deps.renderer.rasterize(h, r.hints));
      timings.rasterize += performance.now() - tRas;
      for (const [k, v] of Object.entries(out.timings)) {
        timings.rasterizeSubSteps[k] = (timings.rasterizeSubSteps[k] ?? 0) + v;
      }
      return out.value;
    }

    let result: Result<unknown>;
    let html: string;
    let identity: string;
    try {
      const tR = performance.now();
      result = await deps.plugin.run(ctx);
      timings.run = performance.now() - tR;
      ({ html, identity } = await derive(result));
    } catch (err) {
      result = errorResult(err);
      ({ html, identity } = await derive(result));
    }

    let png: Uint8Array;
    try {
      png = await rasterizeTimed(result, html);
    } catch (err) {
      result = errorResult(err);
      ({ html, identity } = await derive(result));
      png = await rasterizeTimed(result, html);
    }

    timings.total = performance.now() - t0;
    return { result, identity, png, device: ctx.device, timings };
  }

  // HTML-only scrub. No rasterize cost — purpose-built for cheap
  // dev-iteration surfaces (the dashboard's /preview).
  async function derive(t: Temporal.ZonedDateTime): Promise<DeriveResult> {
    const { ctx, result, html, identity } = await runAndDerive({ t, intent: "scrub" });
    return { result, html, identity, device: ctx.device };
  }

  function committedState(): CommittedState {
    return currentResult && currentImage
      ? {
        t: currentResult.ctx.t,
        result: currentResult.result,
        identity: currentImage.identity,
        device: currentResult.ctx.device,
      }
      : null;
  }

  const app = new Hono()
    .get("/api/setup", (c) =>
      // `image_url` is part of the BYOS setup payload. There's no frame
      // to point at yet — the Device proceeds to /api/display next, which
      // returns the real image URL. This URL 404s if the Device fetches
      // it; firmware recovers via the next /api/display poll. Kept here
      // because BYOS firmware expects the field to be present.
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/images/setup/png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) latestDevice = report;
      const now = deps.now();
      const out = await trigger({ t: now, intent: "poll" });
      const secondsUntilExpiry = Math.max(
        1,
        Math.ceil(out.expiresAt.since(now, { largestUnit: "seconds" }).total({ unit: "seconds" })),
      );
      return c.json({
        status: 0,
        image_url: `${publicOrigin(c)}/images/${out.identity}/png`,
        filename: `image-${out.identity}`,
        refresh_rate: secondsUntilExpiry,
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
    .get("/images/:identity/png", (c) => {
      const id = c.req.param("identity");
      const png = currentImage?.identity === id ? currentImage.png : undefined;
      if (png === undefined) return c.body(null, 404);
      return c.body(png as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
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

  return { app, derive, scrub, committedState };
}
