import { assertEquals, assertExists } from "@std/assert";
import type { RunContext } from "@hztrmnl/server/plugin";
import SleepPlugin from "./main.ts";

function zdt(offset: Temporal.DurationLike): Temporal.ZonedDateTime {
  return Temporal.Instant.from("2026-01-01T00:00:00Z").add(offset).toZonedDateTimeISO("UTC");
}

function ctx(intent: RunContext["intent"]): RunContext {
  return { t: zdt({ hours: 0 }), intent, device: null };
}

Deno.test("run returns a Result with the Sleep view", () => {
  const result = SleepPlugin.run(ctx("poll"));
  assertExists(result.view);
});

Deno.test("run returns a nominal 1-hour validity", () => {
  const result = SleepPlugin.run(ctx("poll"));
  assertEquals(result.validity.hours, 1);
});

Deno.test("run returns a constant state", () => {
  const result = SleepPlugin.run(ctx("poll"));
  assertExists(result.state);
});

Deno.test("run returns no hints (identity is naturally constant)", () => {
  const result = SleepPlugin.run(ctx("poll"));
  assertEquals(result.hints, undefined);
});
