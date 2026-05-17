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

// `derive()` output: pipeline up to HTML and identity, no rasterize.
// For peers that want the live HTML for inspection without paying CDP cost.
// `device` is the DeviceReport the Plugin actually saw on `ctx.device`
// (latest report at the time of the call, or null if no Device has polled
// yet). `error` is non-null when the Plugin / deriveHtml / identityFor
// threw and the result/html/identity reflect the error-view fallback —
// peers that want to surface the failure (e.g. /preview as a 500) read
// this; peers that just want to show *something* (e.g. the dashboard)
// can ignore it.
export type DeriveResult = {
  result: Result<unknown>;
  html: string;
  identity: string;
  device: DeviceReport | null;
  error: Error | null;
};

// `render()` output: full pipeline (derive + rasterize). Post error-
// fallback — if any pipeline step threw, the swapped-in error Result/
// identity/png is what flows out, and `error` carries the original
// failure for peers that want to surface it. Per-step wall-clock is
// not part of this shape; peers that want it open a `withTimings()`
// context around the call and read the bucket — the Conductor and the
// Renderer both record into it via `src/render/timings.ts`.
export type RenderResult = {
  result: Result<unknown>;
  identity: string;
  png: Uint8Array;
  device: DeviceReport | null;
  error: Error | null;
};

// `committedState()` output: what the Device is currently being served
// by the poll path. Null until the first poll has populated Current
// Result + Current Image. `device` is the DeviceReport captured at
// commit time (the Plugin's `ctx.device` for the run that produced
// this state).
export type CommittedState = {
  t: Temporal.ZonedDateTime;
  result: Result<unknown>;
  identity: string;
  device: DeviceReport | null;
} | null;

export type Conductor = {
  // Hono sub-app for the BYOS surface (/api/setup, /api/display, /api/log,
  // /images/:identity/png) and Plugin assets (/assets/*).
  app: Hono;
  // Run Plugin + deriveHtml + identityFor at an arbitrary `t`. Skips
  // rasterize — useful for cheap surfaces that only need the HTML.
  // Never mutates Current state.
  derive(t: Temporal.ZonedDateTime): Promise<DeriveResult>;
  // Full pipeline at an arbitrary `t`: derive + rasterize. Always
  // rasterizes (never short-circuits via identity match — peers that ask
  // for a render want fresh bytes; the poll path is the only consumer
  // that benefits from short-circuiting). Never mutates Current state.
  render(t: Temporal.ZonedDateTime): Promise<RenderResult>;
  // Latest committed Result + Image, or null pre-first-poll. Peers read
  // this to surface "what the Device is seeing right now".
  committedState(): CommittedState;
};

// The orchestration logic lives entirely inside the factory closure;
// peers reach it via the small `render` + `derive` + `committedState`
// surface.
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

  // Each pipeline step is wrapped in `timed()` so callers that open a
  // `withTimings()` context around the call get per-step wall-clock for
  // free. Outside such a context `timed()` is a pass-through, so the
  // poll path pays nothing.

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
    let error: Error | null = null;
    try {
      result = await timed("pipeline.run", () => Promise.resolve(deps.plugin.run(ctx)));
      html = await timed(
        "pipeline.deriveHtml",
        () => Promise.resolve(deps.renderer.deriveHtml(result)),
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
        () => Promise.resolve(deps.renderer.deriveHtml(result)),
      );
      identity = await timed(
        "pipeline.identityFor",
        () => Promise.resolve(deps.identityFor(html)),
      );
    }
    return { ctx, result, html, identity, error };
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
  ): Promise<
    {
      result: Result<unknown>;
      html: string;
      identity: string;
      png: Uint8Array;
      error: Error | null;
    }
  > {
    try {
      const png = await timed(
        "pipeline.rasterize",
        () => deps.renderer.rasterize(html, result.hints),
      );
      return { result, html, identity, png, error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const fallback = errorResult(err);
      const fallbackHtml = await timed(
        "pipeline.deriveHtml",
        () => Promise.resolve(deps.renderer.deriveHtml(fallback)),
      );
      const fallbackIdentity = await timed(
        "pipeline.identityFor",
        () => Promise.resolve(deps.identityFor(fallbackHtml)),
      );
      const png = await timed(
        "pipeline.rasterize",
        () => deps.renderer.rasterize(fallbackHtml, fallback.hints),
      );
      return {
        result: fallback,
        html: fallbackHtml,
        identity: fallbackIdentity,
        png,
        error,
      };
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

  // Full pipeline at an arbitrary `t`. Pure with respect to Current
  // state; the caller decides how to surface the result. Always
  // rasterizes — peers that ask for a render want fresh bytes even when
  // identity matches the Current Image (so non-deterministic views show
  // up). The poll path is the only consumer that benefits from the
  // identity-match short-circuit.
  async function render(t: Temporal.ZonedDateTime): Promise<RenderResult> {
    const derived = await runAndDerive({ t, intent: "scrub" });
    const out = await rasterizeWithFallback(derived.result, derived.html, derived.identity);
    return {
      result: out.result,
      identity: out.identity,
      png: out.png,
      device: derived.ctx.device,
      error: derived.error ?? out.error,
    };
  }

  // Pipeline up to HTML. No rasterize cost.
  async function derive(t: Temporal.ZonedDateTime): Promise<DeriveResult> {
    const { ctx, result, html, identity, error } = await runAndDerive({ t, intent: "scrub" });
    return { result, html, identity, device: ctx.device, error };
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

  return { app, derive, render, committedState };
}
