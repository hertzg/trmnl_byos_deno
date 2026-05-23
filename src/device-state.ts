import type { DeviceReport } from "./plugin/plugin.ts";

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

export type DeviceState = {
  reportDevice(report: DeviceReport): void;
  latestDevice(): DeviceReport | null;
  appendLog(id: string, body: string): void;
  recentLogs(): readonly LogEntry[];
};

export type DeviceStateDeps = {
  now: () => Temporal.ZonedDateTime;
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
  // Newest entries pushed to the end; the dashboard renders bottom-up.
  const logs: LogEntry[] = [];
  return {
    reportDevice(report) {
      latest = report;
    },
    latestDevice() {
      return latest;
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
