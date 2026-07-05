import { assertEquals, assertStrictEquals } from "@std/assert";
import { createTelemetry, type RenderTrace } from "./telemetry.ts";

const zone = "Europe/Berlin";

function makeTrace(overrides: Partial<RenderTrace> = {}): RenderTrace {
  return {
    ranAt: overrides.ranAt ?? Temporal.ZonedDateTime.from(`2026-05-17T12:00[${zone}]`),
    identity: overrides.identity ?? "id-1",
    durations: overrides.durations ?? {
      pluginRun: Temporal.Duration.from({ milliseconds: 12 }),
      identity: Temporal.Duration.from({ milliseconds: 1 }),
      rasterize: Temporal.Duration.from({ milliseconds: 300 }),
    },
    error: overrides.error ?? null,
  };
}

Deno.test("latest() returns null before any trace has been recorded", () => {
  const telemetry = createTelemetry();

  assertEquals(telemetry.latest(), null);
});

Deno.test("latest() returns the trace handed to record()", () => {
  const telemetry = createTelemetry();
  const trace = makeTrace({ identity: "abc123" });

  telemetry.record(trace);

  assertStrictEquals(telemetry.latest(), trace);
});

Deno.test("record() replaces the prior trace rather than accumulating", () => {
  const telemetry = createTelemetry();
  const first = makeTrace({ identity: "first" });
  const second = makeTrace({ identity: "second" });

  telemetry.record(first);
  telemetry.record(second);

  assertStrictEquals(telemetry.latest(), second);
});
