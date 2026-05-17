// A single rendering cycle's diagnostic trace. Recorded by the Conductor at
// the end of each render and read by the Dashboard to populate the trace
// strip. One entry; replaced each render. `error` is non-null when the
// orchestration loop caught a throw (e.g. Plugin failure, view-time JSX
// error); the durations are still populated for whatever stages ran before
// the failure.
export type RenderTrace = {
  ranAt: Temporal.ZonedDateTime;
  identity: string;
  durations: {
    pluginRun: Temporal.Duration;
    identity: Temporal.Duration;
    rasterize: Temporal.Duration;
  };
  error: Error | null;
};

export type Telemetry = {
  record(trace: RenderTrace): void;
  latest(): RenderTrace | null;
};

export function createTelemetry(): Telemetry {
  return {
    record(_trace) {},
    latest() {
      return null;
    },
  };
}
