import { assertEquals } from "@std/assert";
import { identity } from "./device.ts";
import type { Telemetry } from "./device.ts";
import { logBody } from "./log-entry.ts";

const DEVICE = identity({
  base: "http://localhost:3000",
  id: "AA:BB:CC:DD:EE:FF",
  token: "token-abc123",
  fw: "9.9.9",
  board: "x",
});

const STATE: Telemetry = {
  wake: "powercycle",
  refreshRate: 120,
  battery: 3.7,
  rssi: -71,
  cached: false,
};

function entryOf(json: string): Record<string, unknown> {
  const parsed = JSON.parse(json) as { logs: Record<string, unknown>[] };
  return parsed.logs[0];
}

Deno.test("logBody wraps one entry in the logs envelope", () => {
  const parsed = JSON.parse(
    logBody(DEVICE, STATE, "hello", "info", Temporal.Instant.from("2026-08-30T10:00:00Z")),
  );
  assertEquals(Object.keys(parsed), ["logs"]);
  assertEquals(parsed.logs.length, 1);
});

Deno.test("logBody stamps created_at as whole epoch seconds", () => {
  const now = Temporal.Instant.from("2026-08-30T10:00:00.750Z");
  assertEquals(entryOf(logBody(DEVICE, STATE, "hello", "info", now)).created_at, 1788084000);
});

Deno.test("logBody carries the message and level it was given", () => {
  const entry = entryOf(
    logBody(DEVICE, STATE, "disk full", "error", Temporal.Instant.from("2026-08-30T10:00:00Z")),
  );
  assertEquals(entry.message, "disk full");
  assertEquals(entry.level, "error");
});

Deno.test("logBody repeats the telemetry the display poll reports", () => {
  const entry = entryOf(
    logBody(DEVICE, STATE, "hello", "info", Temporal.Instant.from("2026-08-30T10:00:00Z")),
  );
  assertEquals(entry.wifi_signal, -71);
  assertEquals(entry.battery_voltage, 3.7);
  assertEquals(entry.refresh_rate, 120);
  assertEquals(entry.wake_reason, "powercycle");
  assertEquals(entry.firmware_version, "9.9.9");
});
