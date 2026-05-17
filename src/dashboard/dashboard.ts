import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { encodeBase64 } from "@std/encoding/base64";
import type { DeriveResult } from "../conductor/conductor.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { FetchPngFromUrl } from "../render/renderer.ts";
import { withTimings } from "../render/timings.ts";
import { timed } from "../render/timings.ts";
import Dashboard from "./dashboard.tsx";

export type DashboardDeps = {
  // Run Plugin + Renderer.identity at the chosen t and return the Bundle +
  // identity (see Conductor.derive). Used by /preview (whose HTML CDP
  // screenshots) and the dashboard at /, which calls it once per scrub to
  // surface the Result metadata.
  derive: (t: Temporal.ZonedDateTime, intent?: RunContext["intent"]) => Promise<DeriveResult>;
  // CDP-backed url → png. Used by /preview/png to screenshot /preview live,
  // and (until slice #54 switches to renderer.rasterize) by the dashboard's
  // own preview path with the caller's ?t=/?intent= forwarded through.
  fetchPngFromUrl: FetchPngFromUrl;
  // The origin CDP should fetch /preview from. Typically the deno service's
  // internal docker hostname; the Device sees a different origin via the
  // /api/display response.
  internalOrigin: string;
  now: () => Temporal.ZonedDateTime;
};

// Parse the dashboard's datetime-local form value ("YYYY-MM-DDTHH:MM") in
// the server's timezone. Returns `null` for malformed input so the caller
// can surface a parse-error notice instead of guessing.
function parseT(
  raw: string | undefined,
  now: () => Temporal.ZonedDateTime,
): { t: Temporal.ZonedDateTime | null; error: string | null } {
  if (raw === undefined) return { t: null, error: null };
  try {
    return { t: Temporal.PlainDateTime.from(raw).toZonedDateTime(now().timeZoneId), error: null };
  } catch (err) {
    return { t: null, error: (err as Error).message };
  }
}

// Dashboard + the live-render endpoints. Composed as a peer Hono sub-app
// via `app.route("/", dashboard)` so the HTTP surfaces stay legible (each
// prefix lives in one module).
export function createDashboard(deps: DashboardDeps): Hono {
  return new Hono()
    .get("/", async (c) => {
      const now = deps.now();
      const { t: tRequested, error: parseError } = parseT(c.req.query("t"), deps.now);
      const t = tRequested ?? now;

      // Derive locally so we can show Result metadata (state, identity,
      // validity, view name) next to the rendered PNG. The PNG itself comes
      // from CDP screenshotting /preview — when CDP is unreachable we still
      // render the page (Result, scrubber, timings stay useful for debugging)
      // and surface the failure as a notice in place of the image.
      const t0 = performance.now();
      const { value, timings } = await withTimings(async () => {
        const derived = await deps.derive(t, "scrub");
        const previewUrl = `${deps.internalOrigin}/preview?${new URLSearchParams({
          t: toDatetimeLocal(t),
        })}`;
        let png: Uint8Array | null = null;
        let pngError: Error | null = null;
        try {
          png = await timed("pipeline.rasterize", () => deps.fetchPngFromUrl(previewUrl));
        } catch (err) {
          pngError = err instanceof Error ? err : new Error(String(err));
        }
        return { derived, png, pngError };
      });
      const totalMs = performance.now() - t0;

      const page = renderToString(
        Dashboard({
          t,
          tRequested,
          parseError,
          now,
          current: {
            result: value.derived.result,
            identity: value.derived.identity,
            device: value.derived.device,
          },
          timings,
          totalMs,
          pngBase64: value.png ? encodeBase64(value.png) : null,
          pngError: value.pngError?.message ?? null,
        }) as Parameters<typeof renderToString>[0],
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    // Live HTML of the Plugin's current output. `?t=` lets the dashboard
    // (and any other consumer) scrub; default is `now`. This is also the
    // page CDP screenshots when serving /preview/png — the Device-facing
    // render path runs through here too.
    //
    // When the pipeline caught an error and swapped in the error view,
    // status flips to 500 so dev iteration tools (browser, curl) see the
    // failure; the body is still the error-view HTML.
    .get("/preview", async (c) => {
      const { t: tRequested } = parseT(c.req.query("t"), deps.now);
      const intent = (c.req.query("intent") ?? "scrub") as RunContext["intent"];
      const { bundle, error } = await deps.derive(tRequested ?? deps.now(), intent);
      // Derive HTML inline from the Bundle's Result. The Renderer encapsulates
      // its own derivation; Dashboard's /preview is interim (slice #51 swaps
      // CDP onto a loopback origin and this route goes away), so the
      // duplicated renderToString line is the lesser evil compared to widening
      // the Renderer's public surface with a `htmlFor(bundle)` method.
      const html = renderToString(
        bundle.result.view(bundle.result.state) as Parameters<typeof renderToString>[0],
      );
      return c.html(html, error ? 500 : 200, { "cache-control": "no-store" });
    })
    // Live PNG of /preview, via CDP. The Device fetches this on every poll
    // — the JSON returned by /api/display points image_url here.
    .get("/preview/png", async (c) => {
      // Forward `?t=` and `?intent=` so CDP screenshots /preview at the
      // same scrub position the caller requested.
      const passthrough = new URLSearchParams();
      const t = c.req.query("t");
      const intent = c.req.query("intent");
      if (t !== undefined) passthrough.set("t", t);
      if (intent !== undefined) passthrough.set("intent", intent);
      const query = passthrough.toString();
      const previewUrl = `${deps.internalOrigin}/preview${query ? `?${query}` : ""}`;
      const png = await deps.fetchPngFromUrl(previewUrl);
      return c.body(png as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    });
}

// `<input type="datetime-local">` exchanges values in "YYYY-MM-DDTHH:MM".
// The forward query to /preview reuses the same shape so the parsing path
// is identical for the browser and the server-internal hop.
function toDatetimeLocal(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "minute" });
}
