// Per-Device intel reported by the firmware on every /api/display poll
// (see usetrmnl/trmnl-firmware src/api-client/display.cpp addHeaders()):
//
//   ID, Battery-Voltage, RSSI, FW-Version, Model, Width, Height, ...
//
// The Conductor (ADR-0003) builds a fresh RunContext for every trigger and
// includes the latest DeviceReport in `ctx.device`. This file owns parsing
// the headers into the DeviceReport shape (declared in src/plugin/plugin.ts)
// and the closure-bound holder that the HTTP layer updates from the request
// headers on each poll.

import type { DeviceReport } from "./plugin/plugin.ts";

export type DeviceReportHolder = {
  get(): DeviceReport | null;
  updateFromHeaders(headers: Headers, now?: () => Temporal.ZonedDateTime): void;
};

export function createDeviceReportHolder(): DeviceReportHolder {
  let state: DeviceReport | null = null;
  return {
    get: () => state,
    updateFromHeaders(headers, now = () => Temporal.Now.zonedDateTimeISO()) {
      const parsed = parseDeviceHeaders(headers, now);
      if (parsed) state = parsed;
    },
  };
}

// Linear Li-ion approximation: 4.2 V → 100 %, 3.3 V → 0 %, clamped. Reasonable
// for an at-a-glance indicator; the discharge curve is non-linear in reality
// but the difference matters more for runtime estimation than for "looks low,
// charge it soon."
const BATTERY_FULL_V = 4.2;
const BATTERY_EMPTY_V = 3.3;

export function voltageToPercent(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const span = BATTERY_FULL_V - BATTERY_EMPTY_V;
  const pct = ((v - BATTERY_EMPTY_V) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function readHeader(headers: Headers, name: string): string | null {
  return headers.get(name) ?? headers.get(name.toLowerCase()) ?? null;
}

function readNumber(headers: Headers, name: string): number | null {
  const raw = readHeader(headers, name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Returns `null` when the request didn't carry the `ID` header — without it
// we have no Device identity to attach the report to, so the holder treats
// the request as not-a-Device-poll and keeps its previous state.
export function parseDeviceHeaders(
  headers: Headers,
  now: () => Temporal.ZonedDateTime = () => Temporal.Now.zonedDateTimeISO(),
): DeviceReport | null {
  const id = readHeader(headers, "ID");
  if (!id) return null;
  const batteryVoltage = readNumber(headers, "Battery-Voltage");
  return {
    id,
    batteryVoltage,
    batteryPercent: voltageToPercent(batteryVoltage),
    rssi: readNumber(headers, "RSSI"),
    fwVersion: readHeader(headers, "FW-Version"),
    model: readHeader(headers, "Model"),
    width: readNumber(headers, "Width"),
    height: readNumber(headers, "Height"),
    refreshRate: readNumber(headers, "Refresh-Rate"),
    lastSeenAt: now(),
  };
}
