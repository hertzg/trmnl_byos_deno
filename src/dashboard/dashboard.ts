import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { encodeBase64 } from "@std/encoding/base64";
import type { DeriveResult } from "../conductor/conductor.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { Renderer } from "../render/renderer.ts";
import { withTimings } from "../render/timings.ts";
import { timed } from "../render/timings.ts";
import Dashboard from "./dashboard.tsx";

export type DashboardDeps = {
  // Run Plugin + Renderer.identity at the chosen t and return the Bundle +
  // identity (see Conductor.derive). Used by /preview/png to feed
  // renderer.rasterize, and by the dashboard at / to surface Result
  // metadata + inline the rendered PNG.
  derive: (t: Temporal.ZonedDateTime, intent?: RunContext["intent"]) => Promise<DeriveResult>;
  // The Renderer the dashboard rasterizes through. CDP fetches Renderer's
  // own loopback origin during rasterize — the Dashboard never tells CDP a
  // URL on the outward server (slice #51).
  renderer: Renderer;
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
      // from `renderer.rasterize(bundle)` — when CDP is unreachable we
      // still render the page (Result, scrubber, timings stay useful for
      // debugging) and surface the failure as a notice in place of the
      // image.
      const t0 = performance.now();
      const { value, timings } = await withTimings(async () => {
        const derived = await deps.derive(t, "scrub");
        let png: Uint8Array | null = null;
        let pngError: Error | null = null;
        try {
          png = await timed("pipeline.rasterize", () => deps.renderer.rasterize(derived.bundle));
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
    // Live PNG of the Plugin's current output. The Device fetches this on
    // every poll — the JSON returned by /api/display points image_url here.
    // Internally: derive the Bundle for the requested scrub `t`/`intent`,
    // hand it to renderer.rasterize, return the PNG bytes. CDP fetches the
    // Renderer's loopback origin — never this route — for the HTML during
    // rasterize.
    .get("/preview/png", async (c) => {
      const { t: tRequested } = parseT(c.req.query("t"), deps.now);
      const intent = (c.req.query("intent") ?? "scrub") as RunContext["intent"];
      const { bundle } = await deps.derive(tRequested ?? deps.now(), intent);
      const png = await deps.renderer.rasterize(bundle);
      return c.body(png as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    });
}
