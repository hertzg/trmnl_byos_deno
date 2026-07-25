import type { DeviceReport } from "./plugin/plugin.ts";
import type { Clock } from "./clock.ts";

// Observed state from the single Device: the most-recent parsed DeviceReport
// (so the next Plugin.run can carry it forward across header-less polls) and
// a small ring of recent /api/log bodies, so the dashboard can show what the
// firmware has been saying without a stdout scrollback. Both are in-process
// only; "since process start" is the honest framing — the server has no way
// to know when the Device itself rebooted.

export type LogEntry = {
  receivedAt: Temporal.ZonedDateTime;
  id: string;
  body: string;
};

// Raw request headers from the last /api/display poll that carried an ID,
// preserved as an entries array (lower-cased names, in `Headers.entries()`
// order). The dashboard surfaces these on hover so the operator can see
// everything the firmware sent — including headers we don't parse into
// DeviceReport yet — without consulting logs.
export type PollHeaders = ReadonlyArray<readonly [string, string]>;

export type DeviceState = {
  reportDevice(report: DeviceReport, rawHeaders?: PollHeaders): void;
  latestDevice(): DeviceReport | null;
  latestPollHeaders(): PollHeaders | null;
  appendLog(id: string, body: string): void;
  recentLogs(): readonly LogEntry[];
};

export type DeviceStateDeps = {
  now: Clock;
  // How many log entries to keep. Older entries fall off the front.
  // Default is generous enough for a debug session but bounded.
  logRingSize?: number;
  // Optional side-channel — main.ts uses this to mirror logs to stdout
  // so `docker logs` still surfaces them. The service itself is pure
  // in-memory state.
  onLog?: (entry: LogEntry) => void;
};

export function createDeviceState(deps: DeviceStateDeps): DeviceState {
  const ringSize = deps.logRingSize ?? 100;
  let latest: DeviceReport | null = null;
  let latestHeaders: PollHeaders | null = null;
  // Newest entries pushed to the end; the dashboard renders bottom-up.
  const logs: LogEntry[] = [];
  return {
    reportDevice(report, rawHeaders) {
      latest = report;
      if (rawHeaders) latestHeaders = rawHeaders;
    },
    latestDevice() {
      return latest;
    },
    latestPollHeaders() {
      return latestHeaders;
    },
    appendLog(id, body) {
      const entry: LogEntry = { receivedAt: deps.now(), id, body };
      logs.push(entry);
      if (logs.length > ringSize) logs.splice(0, logs.length - ringSize);
      deps.onLog?.(entry);
    },
    recentLogs() {
      return logs;
    },
  };
}
