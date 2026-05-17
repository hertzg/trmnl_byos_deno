import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { Slot } from "../slot/slot.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import Dashboard from "./dashboard.tsx";

// Dashboard at /. A Plugin-debugging surface, not a render path of its own.
//
// This slice (#52) reduces the Dashboard to its minimum: it reads the Slot
// in-process to discover the current Image identity, embeds the same
// `/image/<identity>.png` URL the Device fetches, and reaches into the
// Conductor's HTTP surface to trigger a refill when the Slot is empty.
//
// The scrub form is rendered but non-functional (a `?t=` query is parsed
// but ignored). Real scrub support lands in slice #54, which restores the
// per-render trace + arbitrary-`t` preview against a fresh Bundle.

export type DashboardDeps = {
  // The single-Image cache. Dashboard reads `display()` to learn the
  // current identity without forcing a refill; if `display()` returns
  // null the Dashboard triggers a refill via `conductor.app.request(...)`.
  slot: Slot;
  // Per-cycle render trace, populated by the Conductor. The Dashboard
  // reads `latest()` to render the trace strip (durations + identity
  // + error). `null` before any cycle has run — the strip surfaces a
  // placeholder in that case.
  telemetry: Telemetry;
  // The Conductor's Hono sub-app. The Dashboard uses
  // `conductor.app.request("/api/display")` in-process to refill an empty
  // Slot — single render path, no shortcut.
  conductorApp: Hono;
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
    });
}
