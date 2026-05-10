// ScheduleEvaluator — pure date math.
//
// Given a `Schedule` (array of `ScheduleRule`s), a `Preference`, and the
// current instant, returns the next `(arriveByDate, applicableRule)` pair, or
// `null` if no rule fires within 7 days.
//
// Slice 1 scope: explicit weekday-list `DaySpec` only. Shorthand `"weekday"`,
// `"weekend"`, `"all"` and DST robustness ship in slice 2.

import { DEFAULTS, type Preference, type ScheduleRule, type Weekday } from "./preference.ts";

const TZ = DEFAULTS.timezone;

const WEEKDAY_INDEX: Record<Weekday, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

// Decompose an instant into Berlin wall-clock parts. Uses Intl rather than
// hand-rolled offset math so the same code works year-round (DST handling
// itself is slice 2 — but the parts extraction is correct already).
function berlinParts(d: Date): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: WEEKDAY_INDEX[parts.weekday.toLowerCase().slice(0, 3) as Weekday],
  };
}

// Compute the UTC instant for a given Berlin wall-clock (Y/M/D HH:MM). Probes
// Intl to discover the active offset at that instant — accurate outside DST
// transitions, which is all slice 1 needs.
function berlinWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // First-pass guess: treat the wall-clock as UTC, then nudge by the offset
  // observed in Berlin at that guess.
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(new Date(guess));
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  // "GMT+1", "GMT+2", "GMT" → minutes east of UTC.
  const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(offsetPart);
  const hours = m && m[1] ? Number(m[1]) : 0;
  const mins = m && m[2] ? Number(m[2]) : 0;
  const offsetMinutes = hours * 60 + (hours < 0 ? -mins : mins);
  return new Date(guess - offsetMinutes * 60_000);
}

function dayMatches(rule: ScheduleRule, weekday: number): boolean {
  const days = rule.applicableDays;
  // Slice 1: explicit list only. Shorthand strings fall through to a
  // never-matches result (slice 2 handles them).
  if (Array.isArray(days)) {
    return (days as readonly Weekday[]).some((d) => WEEKDAY_INDEX[d] === weekday);
  }
  return false;
}

function parseTimeOfDay(t: string): { hour: number; minute: number } {
  const [h, m] = t.split(":");
  return { hour: Number(h), minute: Number(m) };
}

export type ScheduleResolution = {
  arriveByDate: Date;
  applicableRule: ScheduleRule;
};

export function nextApplicableArriveBy(
  schedule: readonly ScheduleRule[],
  _preference: Preference,
  now: Date,
): ScheduleResolution | null {
  let best: ScheduleResolution | null = null;
  // Walk forward up to 7 days (today + 6 future days).
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const probe = new Date(now.getTime() + dayOffset * 86_400_000);
    const parts = berlinParts(probe);
    for (const rule of schedule) {
      if (!dayMatches(rule, parts.weekday)) continue;
      const { hour, minute } = parseTimeOfDay(rule.arriveByLocalTime);
      const candidate = berlinWallClockToInstant(
        parts.year,
        parts.month,
        parts.day,
        hour,
        minute,
      );
      if (candidate.getTime() <= now.getTime()) continue;
      if (!best || candidate < best.arriveByDate) {
        best = { arriveByDate: candidate, applicableRule: rule };
      }
    }
    if (best) return best;
  }
  return null;
}
