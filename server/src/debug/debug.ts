import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { DeviceState } from "../device-state.ts";
import type { DeviceProfile } from "../render/profiles.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import { isPattern, renderPattern } from "./patterns.ts";
import DebugPage from "./debug.tsx";

// Debug-mode facade. When system.debug is true this app replaces the
// Conductor AND the dashboard: /api/display returns exactly the operator's
// configured response, /image serves generated test patterns, and / is the
// control panel. The Plugin/renderer/Slot pipeline never starts, so debug
// mode also works when Chrome/CDP is down — handy when the point is to poke
// the panel, not the pipeline.

export type DebugDisplayConfig = {
  pattern: string;
  refreshRate: number;
  status: number;
  temperatureProfile: string;
  specialFunction: string;
  resetFirmware: boolean;
  updateFirmware: boolean;
  firmwareUrl: string;
};

// Matches the Conductor's normal response where a field has a fixed value
// (status 0, temperature_profile "a") so entering debug mode changes nothing
// until the operator edits a field. 60 s refresh keeps iteration tight.
const DEFAULTS: DebugDisplayConfig = {
  pattern: "wedge",
  refreshRate: 60,
  status: 0,
  temperatureProfile: "a",
  specialFunction: "none",
  resetFirmware: false,
  updateFirmware: false,
  firmwareUrl: "",
};

export type DebugDeps = {
  profile: DeviceProfile;
  deviceState: DeviceState;
  friendlyId: string;
  now: () => Temporal.ZonedDateTime;
};

export function createDebugApp(deps: DebugDeps): Hono {
  let cfg: DebugDisplayConfig = { ...DEFAULTS };

  // Patterns are deterministic per (name, profile), and the profile is fixed
  // for the process — render each once, lazily.
  const patternCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  function patternPng(name: string): Promise<Uint8Array<ArrayBuffer>> {
    let png = patternCache.get(name);
    if (!png) {
      png = renderPattern(name, deps.profile);
      patternCache.set(name, png);
    }
    return png;
  }

  function displayResponse(origin: string): Record<string, unknown> {
    return {
      status: cfg.status,
      image_url: `${origin}/image/debug-${cfg.pattern}.png`,
      // The pattern name keys the filename, so switching patterns always
      // reads as a new image to the firmware.
      filename: `debug-${cfg.pattern}`,
      refresh_rate: cfg.refreshRate,
      reset_firmware: cfg.resetFirmware,
      update_firmware: cfg.updateFirmware,
      firmware_url: cfg.firmwareUrl,
      special_function: cfg.specialFunction,
      temperature_profile: cfg.temperatureProfile,
    };
  }

  return new Hono()
    .get("/", (c) => {
      const page = renderToString(
        DebugPage({
          now: deps.now(),
          cfg,
          response: displayResponse(publicOrigin(c)),
          device: deps.deviceState.latestDevice(),
          rawHeaders: deps.deviceState.latestPollHeaders(),
          logs: deps.deviceState.recentLogs(),
        }),
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    .post("/debug/config", async (c) => {
      const body = await c.req.parseBody();
      const str = (k: string): string | undefined =>
        typeof body[k] === "string" ? body[k] as string : undefined;
      const int = (k: string): number | undefined => {
        const raw = str(k);
        if (raw === undefined || raw.trim() === "") return undefined;
        const n = Number(raw);
        return Number.isSafeInteger(n) ? n : undefined;
      };
      const pattern = str("pattern");
      cfg = {
        pattern: pattern !== undefined && isPattern(pattern) ? pattern : cfg.pattern,
        refreshRate: Math.max(1, int("refreshRate") ?? cfg.refreshRate),
        status: int("status") ?? cfg.status,
        temperatureProfile: str("temperatureProfile") ?? cfg.temperatureProfile,
        specialFunction: str("specialFunction") ?? cfg.specialFunction,
        // Unchecked checkboxes are simply absent from the form body, so
        // presence *is* the value — no fallback to the previous state.
        resetFirmware: body["resetFirmware"] !== undefined,
        updateFirmware: body["updateFirmware"] !== undefined,
        firmwareUrl: str("firmwareUrl") ?? cfg.firmwareUrl,
      };
      // 303 turns the browser's next request into a GET.
      return c.redirect("/", 303);
    })
    .get("/api/setup", (c) =>
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/image/setup.png`,
        message: "Welcome (debug mode)",
      }))
    .get("/api/display", (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) {
        deps.deviceState.reportDevice(report, [...c.req.raw.headers.entries()]);
      }
      return c.json(displayResponse(publicOrigin(c)));
    })
    .get("/image/:id{.+\\.png}", async (c) => {
      const id = c.req.param("id").replace(/\.png$/, "");
      const name = id.replace(/^debug-/, "");
      if (name === id || !isPattern(name)) return c.notFound();
      return c.body(await patternPng(name), 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.deviceState.appendLog(id, body);
      return c.body(null, 204);
    });
}
