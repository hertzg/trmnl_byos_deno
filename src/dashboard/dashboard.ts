import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { Slot } from "../slot/slot.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import Dashboard from "./dashboard.tsx";

// Dashboard at /. A Plugin-debugging surface, not a render path of its own.
//
// Three routes, per ADR-0005:
//
//   GET /                     admin page with current Image, trace, scrub
//                             form, and clear button.
//   GET /dashboard/preview.png?t=...  transient scrub render through
//                             PluginManager + Renderer; bypasses the Slot
//                             and never records to Telemetry.
//   POST /dashboard/clear     `slot.clear()` + 303 to `/`. Invalidates the
//                             cache so the next /api/display refills.

export type DashboardDeps = {
  // The single-Image cache. Dashboard reads `display()` to learn the
  // current identity without forcing a refill; if `display()` returns
  // null the Dashboard triggers a refill via `conductor.app.request(...)`.
  // `POST /dashboard/clear` invokes `slot.clear()` directly.
  slot: Slot;
  // Per-cycle render trace, populated by the Conductor. The Dashboard
  // reads `latest()` to render the trace strip (durations + identity
  // + error). `null` before any cycle has run — the strip surfaces a
  // placeholder in that case. Scrub renders do NOT record here.
  telemetry: Telemetry;
  // The Conductor's Hono sub-app. The Dashboard uses
  // `conductor.app.request("/api/display")` in-process to refill an empty
  // Slot — single render path, no shortcut.
  conductorApp: Hono;
  // PluginManager + Renderer for the scrub path. Scrub builds a Bundle for
  // the user-supplied `t`, rasterizes it transiently, and returns the PNG
  // bytes; it never touches the Slot or Telemetry.
  pluginManager: PluginManager;
  renderer: Renderer;
  now: () => Temporal.ZonedDateTime;
};

export function createDashboard(deps: DashboardDeps): Hono {
  return new Hono()
    .get("/", async (c) => {
      // If the Slot is empty (server just booted, or a previous error
      // expired) trigger a refill through the public surface so the
      // Dashboard and the Device share exactly one render path.
      if (deps.slot.display() === null) {
        await (await deps.conductorApp.request("/api/display")).body?.cancel();
      }
      const display = deps.slot.display();
      const now = deps.now();
      const page = renderToString(
        Dashboard({
          now,
          identity: display?.identity ?? null,
          refreshIn: display?.refreshIn ?? null,
          trace: deps.telemetry.latest(),
        }) as Parameters<typeof renderToString>[0],
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    .get("/dashboard/preview.png", async (c) => {
      // Scrub: build a Bundle for the requested `t`, rasterize it, return
      // the PNG bytes. Bypasses the Slot (transient render — the next
      // /api/display still serves the Device's cached Image) and does not
      // record to Telemetry (the trace strip belongs to the Device path).
      const ctx: RunContext = {
        t: parseScrubTime(c.req.query("t"), deps.now),
        intent: "scrub",
        device: null,
      };
      const bundle = await deps.pluginManager.run(ctx);
      const png = await deps.renderer.rasterize(bundle);
      return c.body(png as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/dashboard/clear", (c) => {
      // Invalidate the Slot and bounce back to the dashboard. The page
      // reload will find `slot.display() === null` and trigger a refill
      // through the Conductor's /api/display, which lands a fresh Bundle
      // in the Slot. 303 (See Other) is the right redirect after POST —
      // turns the browser's next request into a GET.
      deps.slot.clear();
      return c.redirect("/", 303);
    });
}

// Parse the `?t=` query into a ZonedDateTime. The dashboard form posts a
// fully-zoned string so Temporal can parse it directly; if anything goes
// wrong (missing, malformed) we fall back to `now()` so the scrub still
// renders something rather than 400'ing.
function parseScrubTime(
  raw: string | undefined,
  now: () => Temporal.ZonedDateTime,
): Temporal.ZonedDateTime {
  if (!raw) return now();
  try {
    return Temporal.ZonedDateTime.from(raw);
  } catch {
    return now();
  }
}
