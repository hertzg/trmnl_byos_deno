import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { RunContext } from "../plugin/plugin.ts";
import type { Slot } from "../slot/slot.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import type { DeviceState } from "../device-state.ts";
import { type BuildInfo, readBuildInfo } from "../build-info.ts";
import type { FirmwareOffer } from "../firmware/firmware.ts";
import { format } from "@std/semver";
import type { Clock } from "../clock.ts";
import Dashboard, { type FirmwareOfferView, type TimelineState } from "./dashboard.tsx";

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
  now: Clock;
  // Shared with the Conductor: the dashboard loads the release list and arms
  // a version, the Device's next poll spends it.
  firmwareOffer: FirmwareOffer;
  // Build identity shown in the topbar. Defaults to reading the baked
  // build-info.json; outside the Docker image that file is absent and the
  // page shows a dateless "<version>+dev" build.
  build?: BuildInfo;
};

export function createDashboard(deps: DashboardDeps): Hono {
  // Versions reach the page as the dotted strings the firmware itself speaks,
  // so the view never has to know about SemVer objects.
  function firmwareView(): FirmwareOfferView {
    const selection = deps.firmwareOffer.selection();
    return {
      releases: deps.firmwareOffer.releases().map((r) => format(r.version)),
      selected: selection === null ? null : format(selection.version),
      armed: deps.firmwareOffer.armed(),
    };
  }

  return new Hono()
    .get("/", async (c) => {
      if (deps.slot.display() === null) {
        await (await deps.conductorApp.request("/api/display")).body?.cancel();
      }
      const display = deps.slot.display();
      const device = deps.deviceState.latestDevice();
      // First dashboard load that knows the Device's model reads the bucket;
      // after that only the picker's refresh button does. The Device's poll
      // path never touches the network.
      await deps.firmwareOffer.load(device?.model ?? null);
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
          device,
          rawHeaders: deps.deviceState.latestPollHeaders(),
          logs: deps.deviceState.recentLogs(),
          firmware: firmwareView(),
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
    })
    .post("/dashboard/firmware", async (c) => {
      // Each button names its own action rather than toggling, so re-posting
      // a stale page can never flip an offer the other way by accident.
      // Anything unrecognised disarms — the harmless direction.
      const body = await c.req.parseBody();
      const model = deps.deviceState.latestDevice()?.model ?? null;
      if (body["action"] === "refresh") {
        await deps.firmwareOffer.load(model, { force: true });
      } else if (body["action"] === "arm") {
        if (typeof body["version"] === "string") deps.firmwareOffer.select(body["version"]);
        deps.firmwareOffer.arm();
      } else {
        deps.firmwareOffer.disarm();
      }
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
// The `?t=` parameter is converted to the system zone (current.timeZoneId).
function resolveDisplayed(
  tRaw: string | undefined,
  dateRaw: string | undefined,
  current: Temporal.ZonedDateTime,
): Displayed {
  let instant = current;
  let dayStart = current.startOfDay();

  if (tRaw) {
    try {
      const parsed = Temporal.ZonedDateTime.from(tRaw);
      // Convert the parsed instant to the system zone.
      instant = parsed.toInstant().toZonedDateTimeISO(current.timeZoneId);
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
  now: Clock,
): Temporal.ZonedDateTime {
  if (!raw) return now();
  try {
    const parsed = Temporal.ZonedDateTime.from(raw);
    // Convert the parsed instant to the system zone (from deps.now()).
    // Same instant, different zone id — so Plugins see the correct local time.
    return parsed.toInstant().toZonedDateTimeISO(now().timeZoneId);
  } catch {
    return now();
  }
}
