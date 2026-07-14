import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { Slot } from "../slot/slot.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import type { DeviceState } from "../device-state.ts";
import { type BuildInfo, readBuildInfo } from "../build-info.ts";
import Dashboard, { type TimelineState } from "./dashboard.tsx";

// Dashboard at /. Debug surface. See ADR-0005.

export type DashboardDeps = {
  slot: Slot;
  telemetry: Telemetry;
  deviceState: DeviceState;
  // The Conductor's sub-app. Used in-process to refill an empty Slot
  // through the same render path the Device hits — no shortcut.
  conductorApp: Hono;
  pluginManager: PluginManager;
  renderer: Renderer;
  now: () => Temporal.ZonedDateTime;
  // Build identity shown in the topbar. Defaults to reading the baked
  // build-info.json; outside the Docker image that file is absent and the
  // page shows a dateless "<version>+dev" build.
  build?: BuildInfo;
};

export function createDashboard(deps: DashboardDeps): Hono {
  return new Hono()
    .get("/", async (c) => {
      if (deps.slot.display() === null) {
        await (await deps.conductorApp.request("/api/display")).body?.cancel();
      }
      const display = deps.slot.display();
      const now = deps.now();
      // The displayed instant + day come from `?t=` / `?date=`; changing
      // the day is always a server round-trip (ADR-0005) so the day's tz
      // boundaries are computed once, here, with Temporal.
      const { instant, dayStart, dayEnd } = resolveDisplayed(
        c.req.query("t"),
        c.req.query("date"),
        now,
      );
      const timeline: TimelineState = {
        tz: now.timeZoneId,
        nowMs: now.epochMilliseconds,
        dayStartMs: dayStart.epochMilliseconds,
        dayEndMs: dayEnd.epochMilliseconds,
        scrubMs: instant.epochMilliseconds,
        cache: display === null ? null : {
          cachedAtMs: display.cachedAt.epochMilliseconds,
          expiresMs: now.add(display.refreshIn).epochMilliseconds,
          identity: display.identity,
        },
      };
      const page = renderToString(
        Dashboard({
          now,
          displayed: instant,
          identity: display?.identity ?? null,
          refreshIn: display?.refreshIn ?? null,
          trace: deps.telemetry.latest(),
          timeline,
          device: deps.deviceState.latestDevice(),
          rawHeaders: deps.deviceState.latestPollHeaders(),
          logs: deps.deviceState.recentLogs(),
          build: deps.build ?? await readBuildInfo(),
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
      // Undocumented debug knob (not exposed in the dashboard UI): ?bitDepth=
      // overrides the profile's PNG bit depth for this one preview render, so
      // panel depths can be eyeballed without editing config. Anything but
      // 1/2/4/8 is ignored.
      const png = await deps.renderer.rasterize(bundle, {
        bitDepth: parseBitDepth(c.req.query("bitDepth")),
      });
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

type Displayed = {
  instant: Temporal.ZonedDateTime;
  dayStart: Temporal.ZonedDateTime;
  dayEnd: Temporal.ZonedDateTime;
};

// Resolve the displayed instant and its day from `?t=` / `?date=`. Any
// parse failure falls back to "today, now" — the dashboard never 500s on a
// bad query string. `dayEnd` is `dayStart + 1 day`; Temporal makes that the
// next midnight even across a 23 h / 25 h DST day.
function resolveDisplayed(
  tRaw: string | undefined,
  dateRaw: string | undefined,
  current: Temporal.ZonedDateTime,
): Displayed {
  let instant = current;
  let dayStart = current.startOfDay();

  if (tRaw) {
    try {
      instant = Temporal.ZonedDateTime.from(tRaw);
      dayStart = instant.startOfDay();
    } catch {
      // Fall through to the default below.
    }
  } else if (dateRaw) {
    try {
      dayStart = Temporal.PlainDate.from(dateRaw).toZonedDateTime(current.timeZoneId);
      // A date alone has no time-of-day: today shows `now`, other days
      // open at their own midnight.
      instant = dayStart.equals(current.startOfDay()) ? current : dayStart;
    } catch {
      // Fall through to the default below.
    }
  }

  return { instant, dayStart, dayEnd: dayStart.add({ days: 1 }) };
}

function parseBitDepth(raw: string | undefined): 1 | 2 | 4 | 8 | undefined {
  if (raw === "1" || raw === "2" || raw === "4" || raw === "8") {
    return Number(raw) as 1 | 2 | 4 | 8;
  }
  return undefined;
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
