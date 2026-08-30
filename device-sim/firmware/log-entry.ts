import type { Identity, Telemetry } from "./device.ts";

// One log entry as serialize_log.cpp builds it, wrapped in the `{"logs":[…]}`
// envelope from serialize_request_api_log.cpp. `now` is a parameter rather
// than a call to Temporal.Now so the payload is reproducible under test.
export function logBody(
  device: Identity,
  state: Telemetry,
  message: string,
  level: string,
  now: Temporal.Instant,
): string {
  const entry = {
    created_at: Math.floor(now.epochMilliseconds / 1000),
    id: 1,
    message,
    source_line: 0,
    source_path: "device-sim",
    wifi_signal: state.rssi,
    wifi_status: "WL_CONNECTED",
    refresh_rate: state.refreshRate,
    sleep_duration: state.refreshRate,
    firmware_version: device.fw,
    special_function: "none",
    battery_voltage: state.battery,
    wake_reason: state.wake,
    free_heap_size: 200000,
    max_alloc_size: 100000,
    level,
  };
  return JSON.stringify({ logs: [entry] });
}
