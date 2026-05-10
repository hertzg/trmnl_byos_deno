// Per-device intel reported by the firmware on every /api/display poll
// (see usetrmnl/trmnl-firmware src/api-client/display.cpp addHeaders()):
//
//   ID, Battery-Voltage, RSSI, FW-Version, Model, Width, Height, ...
//
// The frame coordinator (ADR-0006) is built around fleet-shared frames and
// explicitly forbids per-device branching at the template surface. To stay
// inside that contract while still surfacing device data, we keep a single
// last-seen DeviceState in a closure: every poll updates it; the template's
// onDisplay reads it when generating the next frame. For one-device setups
// (the BYOS norm) the value is always correct; for multi-device setups it
// would reflect "the most recent device's report", which is acceptable since
// the rendered frame is shared anyway.

export type DeviceState = {
  id: string | null;
  batteryVoltage: number | null;
  // Computed from voltage via voltageToPercent — see notes there.
  batteryPercent: number | null;
  rssi: number | null;
  fwVersion: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  refreshRate: number | null;
  lastSeenAt: Date | null;
};

const EMPTY: DeviceState = {
  id: null,
  batteryVoltage: null,
  batteryPercent: null,
  rssi: null,
  fwVersion: null,
  model: null,
  width: null,
  height: null,
  refreshRate: null,
  lastSeenAt: null,
};

export type DeviceStateHolder = {
  get(): DeviceState;
  updateFromHeaders(headers: Headers, now?: () => Date): void;
};

export function createDeviceStateHolder(): DeviceStateHolder {
  let state: DeviceState = EMPTY;
  return {
    get: () => state,
    updateFromHeaders(headers, now = () => new Date()) {
      const parsed = parseDeviceHeaders(headers);
      state = { ...state, ...parsed, lastSeenAt: now() };
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

export function parseDeviceHeaders(headers: Headers): Partial<DeviceState> {
  const batteryVoltage = readNumber(headers, "Battery-Voltage");
  return {
    id: readHeader(headers, "ID"),
    batteryVoltage,
    batteryPercent: voltageToPercent(batteryVoltage),
    rssi: readNumber(headers, "RSSI"),
    fwVersion: readHeader(headers, "FW-Version"),
    model: readHeader(headers, "Model"),
    width: readNumber(headers, "Width"),
    height: readNumber(headers, "Height"),
    refreshRate: readNumber(headers, "Refresh-Rate"),
  };
}
