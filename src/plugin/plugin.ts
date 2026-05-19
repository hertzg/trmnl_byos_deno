// `id` and `lastSeenAt` are non-nullable because they're guaranteed whenever
// we have a report at all (BYOS firmware always sends `ID`; the parser
// stamps `lastSeenAt` on accept). The rest stay nullable because the
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
  device: DeviceReport | null;
};

export type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Record<string, unknown>;
  // Method syntax (not arrow property) is purely about variance: it lets the
  // orchestrator type its receive-side as `Result<unknown>` without forcing
  // every Plugin's `Result<MyState>` to be a strict subtype. Authors still
  // write arrow values (`view: (s) => <Card data={s} />`).
  view(state: S): unknown;
};

export type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};
