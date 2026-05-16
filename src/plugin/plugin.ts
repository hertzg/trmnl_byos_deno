// Heartbeat-derived telemetry from the Device. The holder in src/device.ts
// parses headers into this shape on every /api/display poll; RunContext.device
// is whatever the holder has at the moment Conductor.trigger fires.
// Fields are nullable because they may not have been reported yet, or the
// header may have been missing on a given poll.
export type DeviceReport = {
  id: string | null;
  batteryVoltage: number | null;
  batteryPercent: number | null;
  rssi: number | null;
  fwVersion: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  refreshRate: number | null;
  lastSeenAt: Temporal.ZonedDateTime | null;
};

// Sentinel "no Device has reported yet" report. Useful for tests and for the
// holder's initial state.
export const EMPTY_DEVICE_REPORT: DeviceReport = {
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

export type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender";
  device: DeviceReport;
};

export type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Record<string, unknown>;
  view: (state: S) => unknown;
};

export type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};
