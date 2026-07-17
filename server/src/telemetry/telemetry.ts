// One render's diagnostic trace. Conductor records once per cycle; Dashboard
// reads to render the trace strip. `error` is non-null when the orchestration
// loop caught a synchronous throw, OR when the eager rasterize promise
// rejected asynchronously (after /api/display had already returned) —
// durations still reflect whatever ran before failure.
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
  let stored: RenderTrace | null = null;
  return {
    record(trace) {
      stored = trace;
    },
    latest() {
      return stored;
    },
  };
}
