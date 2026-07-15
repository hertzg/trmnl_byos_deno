// Sleep window math: pure functions for wall-clock sleep scheduling.
//
// This module computes whether the Device is currently in a sleep window,
// when the current window ends, and when the next window starts. All times
// are in the Device's configured timezone (passed as part of RunContext.t).
// No config imports — only types — so unit tests can exercise it without
// side effects.

export type SleepWindowConfig = { from: string; until: string };

export type SleepWindow = { from: Temporal.PlainTime; until: Temporal.PlainTime };

/**
 * Parse an array of SleepWindowConfig entries into typed SleepWindow objects.
 * Each `from` and `until` string is parsed as a Temporal.PlainTime (HH:MM format).
 * Throws if any window has from === until (rejected at load).
 * No defensive validation beyond that (entries expected non-overlapping).
 */
export function parseSleepWindows(raw: SleepWindowConfig[]): SleepWindow[] {
  return raw.map(({ from, until }) => {
    const fromTime = Temporal.PlainTime.from(from);
    const untilTime = Temporal.PlainTime.from(until);

    if (fromTime.equals(untilTime)) {
      throw new Error("from === until");
    }

    return { from: fromTime, until: untilTime };
  });
}

/**
 * If t's wall clock falls inside any window, return the ZonedDateTime when that
 * window ends (computed in zoned-datetime space, DST-safe). Otherwise null.
 *
 * Windows are half-open intervals [from, until): at `from` is inside, at `until`
 * is outside. If `from > until`, the window wraps past midnight (e.g. 23:00–07:00).
 *
 * Precedence: if multiple windows contain t, returns the end of the first match.
 */
export function activeWindowEnd(
  t: Temporal.ZonedDateTime,
  windows: SleepWindow[],
): Temporal.ZonedDateTime | null {
  const tWallClock = t.toPlainTime();

  for (const window of windows) {
    const isInside = isTimeInWindow(tWallClock, window);
    if (isInside) {
      // Determine which day the window ends on.
      let endDate = t.toPlainDate();

      // If from > until, the window wraps past midnight.
      const windowWraps = Temporal.PlainTime.compare(window.from, window.until) > 0;

      if (windowWraps) {
        // Window wraps. Determine if end is today or tomorrow.
        if (Temporal.PlainTime.compare(tWallClock, window.from) >= 0) {
          // t >= from: we're in the evening part of the wrap, end is tomorrow.
          endDate = endDate.add({ days: 1 });
        }
        // else: t < from and t < until means we're in the early morning part
        // (before until on the "tomorrow" side), end is today.
      }

      // Compute end in zoned space to handle DST transitions correctly.
      return endDate.toZonedDateTime({
        timeZone: t.timeZoneId,
        plainTime: window.until,
      });
    }
  }

  return null;
}

/**
 * Find the earliest window start strictly after t.
 *
 * If t is inside a window, the next start is the same day's next window.
 * If t is between windows, returns today's soonest window.
 * If all today's windows have started, returns tomorrow's first window.
 * Returns null only when windows is empty.
 */
export function nextWindowStart(
  t: Temporal.ZonedDateTime,
  windows: SleepWindow[],
): Temporal.ZonedDateTime | null {
  if (windows.length === 0) {
    return null;
  }

  const today = t.toPlainDate();
  const tomorrow = today.add({ days: 1 });

  // Find the earliest window start strictly after t.
  let soonest: Temporal.ZonedDateTime | null = null;

  for (const window of windows) {
    // Check today's window start.
    const todayStart = today.toZonedDateTime({
      timeZone: t.timeZoneId,
      plainTime: window.from,
    });

    if (Temporal.ZonedDateTime.compare(todayStart, t) > 0) {
      // Today's start is after t.
      if (soonest === null || Temporal.ZonedDateTime.compare(todayStart, soonest) < 0) {
        soonest = todayStart;
      }
    } else {
      // Today's start is not after t. Check tomorrow's start.
      const tomorrowStart = tomorrow.toZonedDateTime({
        timeZone: t.timeZoneId,
        plainTime: window.from,
      });

      if (soonest === null || Temporal.ZonedDateTime.compare(tomorrowStart, soonest) < 0) {
        soonest = tomorrowStart;
      }
    }
  }

  return soonest;
}

/**
 * Determine if a wall-clock time falls inside a window.
 * Half-open interval [from, until): at `from` is inside, at `until` is outside.
 * If from > until, wraps past midnight.
 */
function isTimeInWindow(
  wallClock: Temporal.PlainTime,
  window: SleepWindow,
): boolean {
  const cmpFromLow = Temporal.PlainTime.compare(wallClock, window.from);
  const cmpUntilHigh = Temporal.PlainTime.compare(wallClock, window.until);

  if (Temporal.PlainTime.compare(window.from, window.until) > 0) {
    // Window wraps past midnight: [from, 24:00) ∪ [00:00, until)
    return cmpFromLow >= 0 || cmpUntilHigh < 0;
  } else {
    // Normal window: [from, until)
    return cmpFromLow >= 0 && cmpUntilHigh < 0;
  }
}
