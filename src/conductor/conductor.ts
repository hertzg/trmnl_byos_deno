import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { renderToString } from "hono/jsx/dom/server";
import { encodeBase64 } from "@std/encoding/base64";
import type { DeviceReport, Plugin, Result, RunContext } from "../plugin/plugin.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import Dashboard from "./dashboard.tsx";

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

// `createConductor` returns a Hono directly. The orchestration logic
// lives entirely inside the factory closure — its only external surface
// is HTTP.
export function createConductor(deps: ConductorDeps): Hono {
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

  return new Hono()
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
    // Dashboard at /. ADR-0005: hands the Conductor a `{ t, intent: "scrub",
    // device }` trigger and previews the resulting Image. Does not touch
    // Current Result or Current Image.
    .get("/", async (c) => {
      const now = deps.now();
      // Forward-only scrubber: never run the Plugin at a moment earlier than
      // the Current Result's commit or the wall clock. If wall clock has
      // advanced past the Current Result, `now` wins.
      const tMin = currentResult && Temporal.ZonedDateTime.compare(currentResult.ctx.t, now) > 0
        ? currentResult.ctx.t
        : now;
      // Datetime-local form value: "YYYY-MM-DDTHH:MM" (no timezone). Interpret
      // in the server's timezone — that's the timezone the page renders in,
      // so it's the user's mental model of "what time t means".
      const tParam = c.req.query("t");
      const tRequested = tParam !== undefined
        ? Temporal.PlainDateTime.from(tParam).toZonedDateTime(now.timeZoneId)
        : tMin;
      const t = Temporal.ZonedDateTime.compare(tRequested, tMin) < 0 ? tMin : tRequested;
      const { result, html, identity } = await runAndDerive({ t, intent: "scrub" });
      const out = await rasterizeWithFallback(result, html, identity);
      const page = renderToString(
        Dashboard({
          t,
          tMin,
          tCommit: currentResult?.ctx.t ?? null,
          now,
          result: out.result,
          identity: out.identity,
          pngBase64: encodeBase64(out.png),
        }) as Parameters<typeof renderToString>[0],
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    // Dev-iteration: live HTML at t=now via scrub. ADR-0005: no CDP cost.
    // Does not touch Current Result or Current Image.
    .get("/preview", async (c) => {
      const { html } = await runAndDerive({ t: deps.now(), intent: "scrub" });
      return c.html(html, 200, { "cache-control": "no-store" });
    })
    // Dev-iteration: live PNG at t=now via scrub. Full pipeline including
    // the rasterize-with-fallback. Does not touch Current Result or Current
    // Image.
    .get("/preview/png", async (c) => {
      const { result, html, identity } = await runAndDerive({
        t: deps.now(),
        intent: "scrub",
      });
      const out = await rasterizeWithFallback(result, html, identity);
      return c.body(out.png as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
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
}
