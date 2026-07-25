import type { DeviceReport } from "./plugin/plugin.ts";
import type { Clock } from "./clock.ts";

// Linear Li-ion approximation: 4.2 V → 100 %, 3.3 V → 0 %, clamped. Coarse
// but fine for an at-a-glance indicator.
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
// we have no Device identity to attach the report to. Caller treats this as
// not-a-Device-poll and keeps its previous state.
export function parseDeviceHeaders(
  headers: Headers,
  now: Clock,
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
