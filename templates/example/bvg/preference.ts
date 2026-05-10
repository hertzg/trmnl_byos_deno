// Configuration schema for the journey board.
//
// A `Preference` describes one user's commute intent: who's commuting, where
// from, where to, when it applies, what's allowed, and how the surfacing is
// tuned. Preferences are pure value objects — they're loaded from
// `routes.ts` at startup and never mutated.
//
// Tunable values cascade through three layers, most-specific wins:
//
//     DEFAULTS  ←  Preference  ←  ScheduleRule
//
// Anywhere a tunable can be overridden, the override field is named
// `…Override` (on a ScheduleRule) or shares the bare name (on a Preference).
// `undefined` falls through; an explicit `0` or `[]` is a real value and stops
// the chain. Code outside `resolveTunables` should consume `ResolvedTunables`
// rather than reading from `DEFAULTS` directly.

// ─── value objects ──────────────────────────────────────────────────────────

export type Stop = {
  // The stop's id in BVG's HAFAS database. Look one up with:
  //   curl 'https://v6.bvg.transport.rest/locations?query=<name>'
  hafasStopId: string;

  // Short display name shown in row captions, e.g. "Hbf", "Alex".
  displayName: string;

  // Minutes between the user's physical address (home/office) and the stop's
  // platform. Added to BVG's first-leg departure time to compute the user's
  // leave-by, and subtracted from the destination arrival time to compute
  // when they actually walk in the door.
  walkingMinutesBetweenStopAndAddress: number;
};

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// Day-of-week selector for a ScheduleRule.
//   ["mon", "tue", "wed", "thu", "fri"]   explicit list
//   "weekday"                              shorthand for the above
//   "weekend"                              shorthand for ["sat", "sun"]
//   "all"                                  every day
export type DaySpec = readonly Weekday[] | "weekday" | "weekend" | "all";

// Wall-clock time in DEFAULTS.timezone (Europe/Berlin). 24-hour, zero-padded:
// "09:30", "14:00", "19:05".
export type TimeOfDay = `${number}${number}:${number}${number}`;

// ─── schedule rule (most-granular tunables) ─────────────────────────────────

export type ScheduleRule = {
  // Which days this rule fires on.
  applicableDays: DaySpec;

  // The user must be at the destination by this local time on `applicableDays`.
  arriveByLocalTime: TimeOfDay;

  // ── per-rule overrides — replace (don't merge with) the values inherited
  //    from the Preference and DEFAULTS. `undefined` falls through. ──

  // Minutes before the arrive-by moment the visibility window opens.
  windowLeadMinutesOverride?: number;

  // Minutes after the arrive-by moment the window stays open. Skewed small
  // because arriving late is worse than arriving early.
  windowLateTailMinutesOverride?: number;

  // Minutes after a row's leave-by passes that it stays visible with a
  // "leave now" warning. Bounds how stale a still-actionable row can be.
  imminentDepartureGraceMinutesOverride?: number;

  // Minutes the user wants between "be ready" and the actual leave-by. Used
  // to compute the be-ready-by anchor displayed alongside the leave-by.
  preparationMinutesOverride?: number;

  // BVG line names whose presence on any leg drops a candidate entirely
  // (e.g. ["BUS", "FEX"]). Override replaces; an explicit empty array means
  // "no exclusions on this rule".
  excludedLineNamesOverride?: readonly string[];
};

// ─── preference (aggregate root) ────────────────────────────────────────────

export type Preference = {
  // Stable identifier for logs, metrics, and footnote keys. Should be unique
  // across all preferences in a config. Not user-visible.
  preferenceKey: string;

  // Glyph rendered inside the circular badge that prefixes every Row from
  // this preference. Single character or short emoji works best on e-ink.
  rowIcon: string;

  // Short human label appearing in row captions, e.g. "Office", "Studio",
  // "Home". Used to identify the preference in cancellation strips and the
  // empty-state hint ("next: Mon 09:30 · A · Office").
  rowLabel: string;

  // Where the user departs from. Different preferences may use different
  // origin stops even for the same person (e.g. weekday Hbf vs Friday gym).
  origin: Stop;

  // Where the user must arrive.
  destination: Stop;

  // The recurrence and timing of this commute. Preferences with no rules
  // applicable to the current week are inactive.
  schedule: readonly ScheduleRule[];

  // ── per-preference overrides — apply when a ScheduleRule doesn't override
  //    further. Fall through to DEFAULTS when omitted. ──

  windowLeadMinutes?: number;
  windowLateTailMinutes?: number;
  imminentDepartureGraceMinutes?: number;
  preparationMinutes?: number;
  excludedLineNames?: readonly string[];
};

export type RoutesConfig = {
  preferences: readonly Preference[];
};

// ─── defaults (fallback floor) ──────────────────────────────────────────────

// All durations are in minutes unless suffixed `Seconds`. All times are in
// `timezone`. Code outside `resolveTunables` should not read these directly —
// consume `ResolvedTunables` instead so per-preference overrides take effect.
export const DEFAULTS = {
  timezone: "Europe/Berlin",

  // Visibility window geometry. Asymmetric: long lead so options surface
  // early, short late tail because arriving late is more painful than
  // arriving early.
  windowLeadMinutes: 60,
  windowLateTailMinutes: 15,

  // Imminent-departure handling.
  imminentDepartureGraceMinutes: 5,

  // Preparation buffer for "be ready by" anchor. Zero by default — opt in
  // per preference.
  preparationMinutes: 0,

  // Exclusions empty by default. Per-preference and per-rule overrides add
  // them where needed.
  excludedLineNames: [] as readonly string[],

  // Render budget. Rows above this cap are clipped from the tail (latest
  // leave-by), with a footnote summarising what was dropped.
  hardRowCap: 10,

  // Refresh cadence floors and ceilings, in seconds. Pipeline picks the
  // shortest applicable interval that still respects the floor.
  refreshFloorSeconds: 30,
  refreshRealtimeCeilingSeconds: 90,
  refreshIdleCeilingSeconds: 300,
} as const;

// ─── resolved tunables (the only thing pipeline code consumes) ──────────────

// Result of cascading DEFAULTS ← Preference ← ScheduleRule for one active
// preference at one point in time. All fields are required and concrete —
// downstream code never sees `undefined` and never re-reads `DEFAULTS`.
export type ResolvedTunables = {
  windowLeadMinutes: number;
  windowLateTailMinutes: number;
  imminentDepartureGraceMinutes: number;
  preparationMinutes: number;
  excludedLineNames: readonly string[];
};

export function resolveTunables(
  preference: Preference,
  applicableRule: ScheduleRule,
): ResolvedTunables {
  return {
    windowLeadMinutes: applicableRule.windowLeadMinutesOverride ??
      preference.windowLeadMinutes ??
      DEFAULTS.windowLeadMinutes,

    windowLateTailMinutes: applicableRule.windowLateTailMinutesOverride ??
      preference.windowLateTailMinutes ??
      DEFAULTS.windowLateTailMinutes,

    imminentDepartureGraceMinutes:
      applicableRule.imminentDepartureGraceMinutesOverride ??
        preference.imminentDepartureGraceMinutes ??
        DEFAULTS.imminentDepartureGraceMinutes,

    preparationMinutes: applicableRule.preparationMinutesOverride ??
      preference.preparationMinutes ??
      DEFAULTS.preparationMinutes,

    excludedLineNames: applicableRule.excludedLineNamesOverride ??
      preference.excludedLineNames ??
      DEFAULTS.excludedLineNames,
  };
}
