import { assertEquals } from "@std/assert";
import { createTelemetry } from "./telemetry.ts";

Deno.test("latest() returns null before any trace has been recorded", () => {
  const telemetry = createTelemetry();

  assertEquals(telemetry.latest(), null);
});
