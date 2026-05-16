// Heartbeat-derived telemetry from a real Device poll. The holder in
// src/device.ts parses headers into this shape on every /api/display poll;
// RunContext.device is whatever the holder has at the moment
// Conductor.trigger fires (or `null` if no poll has arrived yet).
//
// `id` and `lastSeenAt` are non-nullable because they are guaranteed whenever
// we have a report at all (the BYOS firmware always sends `ID`; the holder
// stamps `lastSeenAt` on accept). The other fields stay nullable because the
// firmware may genuinely omit those headers.
export type DeviceReport = {
  id: string;
  batteryVoltage: number | null;
  batteryPercent: number | null;
  rssi: number | null;
  fwVersion: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  refreshRate: number | null;
  lastSeenAt: Temporal.ZonedDateTime;
};

export type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender";
  // `null` before any Device poll has arrived. Once present, the report is
  // a real Device's report — `id` and `lastSeenAt` are always populated;
  // the rest stay nullable because the firmware may genuinely omit headers.
  device: DeviceReport | null;
};

export type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Record<string, unknown>;
  // Declared as a method (not an arrow property) so the type is bivariant
  // in S. This lets the orchestrator type its receive-side as
  // `Result<unknown>` without forcing every Plugin's `Result<MyState>` to
  // be a strict subtype. Authors still write arrow-function values
  // (`view: (s) => <Card data={s} />`) — method syntax is purely about
  // the type's variance, not the value's shape.
  view(state: S): unknown;
};

export type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};
