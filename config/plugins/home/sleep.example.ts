// Starter template for the gitignored `sleep.ts`. Copy this file to
// `sleep.ts` and edit it for your own sleep windows:
//
//   cp config/plugins/home/sleep.example.ts config/live/plugins/home/sleep.ts
//
// Each entry describes a wall-clock sleep window (from/until in HH:MM format).
// Entries are expected to be non-overlapping; from > until wraps past midnight
// (e.g. 23:00–07:00). The Device stops refreshing during these windows and
// deep-sleeps until the window ends.

import type { SleepWindowConfig } from "@hztrmnl/home/sleep-window";

export const SLEEP_WINDOWS: SleepWindowConfig[] = [
  { from: "23:00", until: "07:00" },
];
