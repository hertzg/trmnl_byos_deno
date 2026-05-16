export type DeviceReport = Record<string, unknown>;

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
