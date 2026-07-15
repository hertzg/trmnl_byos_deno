import { assertEquals, assertThrows } from "@std/assert";
import {
  activeWindowEnd,
  nextWindowStart,
  parseSleepWindows,
  type SleepWindow,
} from "./sleep-window.ts";

// Temporal test helper
function t(spec: string): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(spec);
}

Deno.test("parseSleepWindows: simple same-day window 09:00–17:00", () => {
  // Should parse wall-clock time strings into Temporal.PlainTime objects.
  const result = parseSleepWindows([{ from: "09:00", until: "17:00" }]);

  assertEquals(result.length, 1);
  assertEquals(result[0].from.hour, 9);
  assertEquals(result[0].from.minute, 0);
  assertEquals(result[0].until.hour, 17);
  assertEquals(result[0].until.minute, 0);
});

Deno.test("parseSleepWindows: rejects from === until", () => {
  // Should throw when from and until are the same.
  assertThrows(
    () => parseSleepWindows([{ from: "23:00", until: "23:00" }]),
    Error,
    "from === until",
  );
});

Deno.test("activeWindowEnd: t at 09:30 in 09:00–17:00 window → ends at 17:00 today", () => {
  // When t's wall clock is inside a window, return the ZonedDateTime when the window ends.
  const windows = parseSleepWindows([{ from: "09:00", until: "17:00" }]);
  const t_inside = t("2026-07-15T09:30[Europe/Berlin]");

  const result = activeWindowEnd(t_inside, windows);

  assertEquals(result, t("2026-07-15T17:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: t at 09:00 (boundary) → inside the window", () => {
  // Half-open interval: [from, until) means at from is inside.
  const windows = parseSleepWindows([{ from: "09:00", until: "17:00" }]);
  const t_at_from = t("2026-07-15T09:00[Europe/Berlin]");

  const result = activeWindowEnd(t_at_from, windows);

  assertEquals(result, t("2026-07-15T17:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: t at 17:00 (boundary) → outside the window", () => {
  // Half-open interval: [from, until) means at until is outside.
  const windows = parseSleepWindows([{ from: "09:00", until: "17:00" }]);
  const t_at_until = t("2026-07-15T17:00[Europe/Berlin]");

  const result = activeWindowEnd(t_at_until, windows);

  assertEquals(result, null);
});

Deno.test("activeWindowEnd: t at 08:59 (just before from) → outside the window", () => {
  const windows = parseSleepWindows([{ from: "09:00", until: "17:00" }]);
  const t_before = t("2026-07-15T08:59[Europe/Berlin]");

  const result = activeWindowEnd(t_before, windows);

  assertEquals(result, null);
});

Deno.test("activeWindowEnd: wrap past midnight 23:00–07:00, t at 23:30 today → ends at 07:00 tomorrow", () => {
  // When from > until, the window wraps past midnight.
  // t at 23:30 should end at 07:00 tomorrow.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_evening = t("2026-07-15T23:30[Europe/Berlin]");

  const result = activeWindowEnd(t_evening, windows);

  assertEquals(result, t("2026-07-16T07:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: wrap past midnight 23:00–07:00, t at 06:00 today → ends at 07:00 today", () => {
  // t at 06:00 is inside the night window (which started yesterday at 23:00).
  // It should end today at 07:00.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_early_morning = t("2026-07-15T06:00[Europe/Berlin]");

  const result = activeWindowEnd(t_early_morning, windows);

  assertEquals(result, t("2026-07-15T07:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: wrap past midnight 23:00–07:00, t at 08:00 → outside the window", () => {
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_after = t("2026-07-15T08:00[Europe/Berlin]");

  const result = activeWindowEnd(t_after, windows);

  assertEquals(result, null);
});

Deno.test("activeWindowEnd: multiple windows, t inside first → returns end of that window", () => {
  const windows = parseSleepWindows([
    { from: "09:00", until: "12:00" },
    { from: "14:00", until: "17:00" },
  ]);
  const t_in_first = t("2026-07-15T10:00[Europe/Berlin]");

  const result = activeWindowEnd(t_in_first, windows);

  assertEquals(result, t("2026-07-15T12:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: multiple windows, t inside second → returns end of that window", () => {
  const windows = parseSleepWindows([
    { from: "09:00", until: "12:00" },
    { from: "14:00", until: "17:00" },
  ]);
  const t_in_second = t("2026-07-15T15:00[Europe/Berlin]");

  const result = activeWindowEnd(t_in_second, windows);

  assertEquals(result, t("2026-07-15T17:00[Europe/Berlin]"));
});

Deno.test("activeWindowEnd: empty windows list → null", () => {
  const windows: SleepWindow[] = [];
  const t_any = t("2026-07-15T10:00[Europe/Berlin]");

  const result = activeWindowEnd(t_any, windows);

  assertEquals(result, null);
});

Deno.test("nextWindowStart: t at 09:30, window 23:00–07:00 → next start is tomorrow 23:00", () => {
  // t is awake, before today's window.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_awake = t("2026-07-15T09:30[Europe/Berlin]");

  const result = nextWindowStart(t_awake, windows);

  assertEquals(result, t("2026-07-15T23:00[Europe/Berlin]"));
});

Deno.test("nextWindowStart: t at 06:30 inside 23:00–07:00, → next start is today 23:00", () => {
  // t is inside a window, next window start is same day's 23:00 (wrapping day).
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_sleeping = t("2026-07-15T06:30[Europe/Berlin]");

  const result = nextWindowStart(t_sleeping, windows);

  assertEquals(result, t("2026-07-15T23:00[Europe/Berlin]"));
});

Deno.test("nextWindowStart: t at 23:00 exactly → already at a window start, next is tomorrow", () => {
  // "strictly after t" means next window start is tomorrow.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_at_start = t("2026-07-15T23:00[Europe/Berlin]");

  const result = nextWindowStart(t_at_start, windows);

  assertEquals(result, t("2026-07-16T23:00[Europe/Berlin]"));
});

Deno.test("nextWindowStart: multiple windows, t between them → picks soonest", () => {
  const windows = parseSleepWindows([
    { from: "12:00", until: "14:00" },
    { from: "20:00", until: "22:00" },
  ]);
  const t_between = t("2026-07-15T10:00[Europe/Berlin]");

  const result = nextWindowStart(t_between, windows);

  // Soonest is 12:00 today.
  assertEquals(result, t("2026-07-15T12:00[Europe/Berlin]"));
});

Deno.test("nextWindowStart: t after all windows today → next window tomorrow's first", () => {
  const windows = parseSleepWindows([
    { from: "12:00", until: "14:00" },
    { from: "20:00", until: "22:00" },
  ]);
  const t_after_all = t("2026-07-15T23:00[Europe/Berlin]");

  const result = nextWindowStart(t_after_all, windows);

  // Next window is tomorrow's 12:00.
  assertEquals(result, t("2026-07-16T12:00[Europe/Berlin]"));
});

Deno.test("nextWindowStart: empty windows list → null", () => {
  const windows: SleepWindow[] = [];
  const t_any = t("2026-07-15T10:00[Europe/Berlin]");

  const result = nextWindowStart(t_any, windows);

  assertEquals(result, null);
});

Deno.test("DST: Spring forward 2026-03-29 Europe/Berlin, t at 06:58 in 23:00–07:00 window", () => {
  // At 2026-03-29 02:00, clocks jump to 03:00 (spring forward).
  // A window 23:00–07:00 spanning this night should compute the correct end time
  // at 07:00 and the duration until it.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_early_wake = t("2026-03-29T06:58[Europe/Berlin]");

  const end = activeWindowEnd(t_early_wake, windows);

  // Window should end at 07:00 on the same day (after the spring forward).
  assertEquals(end, t("2026-03-29T07:00[Europe/Berlin]"));

  // Duration until end should be ~2 minutes. Compute it.
  const duration = end!.since(t_early_wake);
  const mins = duration.total({ unit: "minutes" });
  assertEquals(Math.abs(mins - 2) < 0.01, true); // Allow floating point tolerance
});

Deno.test("DST: Fall back 2026-10-25 Europe/Berlin, 23:00–07:00 window overnight", () => {
  // At 2026-10-25 03:00, clocks fall back to 02:00 (fall back).
  // A window 23:00–07:00 spanning this night should compute the correct end time
  // and reflect the extra hour from the fall-back (9 hours instead of 8).
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_evening = t("2026-10-24T23:00[Europe/Berlin]");

  const end = activeWindowEnd(t_evening, windows);

  // Window should end at 07:00 on the next day.
  assertEquals(end, t("2026-10-25T07:00[Europe/Berlin]"));

  // Duration should reflect the fall-back (9 hours = 540 minutes instead of 8 hours = 480).
  const duration = end!.since(t_evening);
  const mins = duration.total({ unit: "minutes" });
  assertEquals(Math.abs(mins - 540) < 0.01, true); // Allow floating point tolerance
});

Deno.test("activeWindowEnd: early-wake exemption, t = 06:58 in 23:00–07:00 → remainder is ~2 min", () => {
  // This test validates the early-wake scenario: device wakes up at 06:58 (RC drift),
  // inside an 8-hour night window, and should get a short remainder (~2 minutes)
  // so it can re-poll and exit on time. The 5-minute floor should NOT apply.
  const windows = parseSleepWindows([{ from: "23:00", until: "07:00" }]);
  const t_early = t("2026-07-15T06:58[Europe/Berlin]");

  const end = activeWindowEnd(t_early, windows);
  const remainder = end!.since(t_early);

  const mins = remainder.total({ unit: "minutes" });
  assertEquals(mins > 0 && mins < 5, true); // Should be a short remainder, not floored
});
