import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { Slot } from "../slot/slot.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import Dashboard from "./dashboard.tsx";

// Dashboard at /. Debug surface. See ADR-0005.

export type DashboardDeps = {
  slot: Slot;
  telemetry: Telemetry;
  // The Conductor's sub-app. Used in-process to refill an empty Slot
  // through the same render path the Device hits — no shortcut.
  conductorApp: Hono;
  pluginManager: PluginManager;
  renderer: Renderer;
  now: () => Temporal.ZonedDateTime;
};

export function createDashboard(deps: DashboardDeps): Hono {
  return new Hono()
    .get("/", async (c) => {
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
        }),
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    .get("/dashboard/preview.png", async (c) => {
      // Scrub bypasses Slot and Telemetry — the trace strip belongs to the
      // Device path; the cached Image stays for the Device's next poll.
      const ctx: RunContext = {
        t: parseScrubTime(c.req.query("t"), deps.now),
        intent: "scrub",
        device: null,
      };
      const bundle = await deps.pluginManager.run(ctx);
      const identity = await deps.renderer.identity(bundle);
      const png = await deps.renderer.rasterize(bundle);
      const validity = String(bundle.result.validity.total({ unit: "seconds" }));

      return c.body(png, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
        "x-identity": identity,
        "x-validity": validity,
      });
    })
    .post("/dashboard/clear", (c) => {
      deps.slot.clear();
      // 303 turns the browser's next request into a GET.
      return c.redirect("/", 303);
    });
}

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
