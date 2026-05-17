import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { encodeBase64 } from "@std/encoding/base64";
import type { CommittedState, DeriveResult, ScrubResult } from "../conductor/conductor.ts";
import { withTimings } from "../render/timings.ts";
import Dashboard from "./dashboard.tsx";

export type DashboardDeps = {
  // HTML-only scrub. Used by /preview for cheap dev-iteration (no CDP cost).
  derive: (t: Temporal.ZonedDateTime) => Promise<DeriveResult>;
  // Full pipeline at an arbitrary `t` (derive + rasterize + timings). Used
  // by both / (the dashboard) and /preview/png. The dashboard never touches
  // Current state directly; everything flows through the Conductor surface.
  scrub: (t: Temporal.ZonedDateTime) => Promise<ScrubResult>;
  // Latest Current Result + Current Image, or null pre-first-poll. Lets the
  // dashboard render the "committed (Device sees this)" column.
  committedState: () => CommittedState;
  now: () => Temporal.ZonedDateTime;
};

// Dashboard at /. ADR-0005: a Plugin-debugging surface, not just a preview.
// Composed as a peer Hono sub-app via `app.route("/", dashboard)` so the HTTP
// surfaces stay legible (each prefix lives in one module).
export function createDashboard(deps: DashboardDeps): Hono {
  return new Hono()
    .get("/", async (c) => {
      const now = deps.now();
      const committed = deps.committedState();

      // Datetime-local form value: "YYYY-MM-DDTHH:MM" (no timezone). Interpret
      // in the server's timezone — that's the timezone the page renders in,
      // so it's the user's mental model of "what time t means". Malformed
      // input is treated as "no request" (default fires) and surfaced as a
      // parseError notice so the operator sees what happened.
      const tParam = c.req.query("t");
      let tRequested: Temporal.ZonedDateTime | null = null;
      let parseError: string | null = null;
      if (tParam !== undefined) {
        try {
          tRequested = Temporal.PlainDateTime.from(tParam).toZonedDateTime(now.timeZoneId);
        } catch (err) {
          parseError = (err as Error).message;
        }
      }

      // Default (no `?t=`) lands on commit (or now if nothing's committed
      // yet). Explicit `?t=` clamps forward to the commit moment when one
      // exists — and only then. Commit is the right floor because the
      // clamp exists to protect the committed-vs-current A/B; with no
      // commit there's nothing to protect, so any `?t=` passes through.
      const t = tRequested === null
        ? committed?.t ?? now
        : committed && Temporal.ZonedDateTime.compare(tRequested, committed.t) < 0
        ? committed.t
        : tRequested;

      // Wrap the scrub in a timings collector. The Conductor and Renderer
      // both record per-step wall-clock into the bucket via timed(); we
      // pass it to the JSX so the dashboard can render the strip.
      const t0 = performance.now();
      const { value: out, timings } = await withTimings(() => deps.scrub(t));
      const totalMs = performance.now() - t0;
      const page = renderToString(
        Dashboard({
          t,
          tRequested,
          parseError,
          now,
          committed,
          current: { result: out.result, identity: out.identity, device: out.device },
          timings,
          totalMs,
          pngBase64: encodeBase64(out.png),
        }) as Parameters<typeof renderToString>[0],
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    // Dev-iteration: live HTML at t=now via scrub. ADR-0005: no CDP cost
    // (no rasterize). Does not touch Current Result or Current Image.
    .get("/preview", async (c) => {
      const { html } = await deps.derive(deps.now());
      return c.html(html, 200, { "cache-control": "no-store" });
    })
    // Dev-iteration: live PNG at t=now via full scrub pipeline. Does not
    // touch Current Result or Current Image.
    .get("/preview/png", async (c) => {
      const out = await deps.scrub(deps.now());
      return c.body(out.png as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    });
}
