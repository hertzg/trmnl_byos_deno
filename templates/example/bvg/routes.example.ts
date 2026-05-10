// Starter template for the gitignored `routes.ts`. Copy this file to
// `routes.ts` and edit it for your own commute:
//
//   cp templates/example/bvg/routes.example.ts templates/example/bvg/routes.ts
//
// Each `Preference` describes one commute intent (who, where, when). The
// configuration is a list of preferences that share the screen — interleaved
// rows by leave-by, each tagged with the preference's `rowIcon` and
// `rowLabel`.
//
// Tunables cascade most-specific-wins:
//
//     DEFAULTS  ←  Preference  ←  ScheduleRule
//
// Omit a tunable to inherit; set it to override. See `preference.ts` for
// the full schema, default values, and the resolution rules.

import type { Preference, RoutesConfig } from "./preference.ts";

// ─── stops you reuse across preferences ─────────────────────────────────────

const HAUPTBAHNHOF = {
  hafasStopId: "900003201",
  displayName: "Hbf",
  walkingMinutesBetweenStopAndAddress: 8,
} as const;

const ALEXANDERPLATZ = {
  hafasStopId: "900100003",
  displayName: "Alex",
  walkingMinutesBetweenStopAndAddress: 4,
} as const;

const SCHOENEWEIDE = {
  hafasStopId: "900058101",
  displayName: "Schöneweide",
  walkingMinutesBetweenStopAndAddress: 6,
} as const;

const LEHRTER_STR = {
  hafasStopId: "900003103",
  displayName: "Lehrter",
  walkingMinutesBetweenStopAndAddress: 3,
} as const;

// ─── preferences ────────────────────────────────────────────────────────────

// Person A's weekday commute to the office. Inherits all tunables from
// DEFAULTS — no overrides at the preference or rule level.
const A_OFFICE_WEEKDAY: Preference = {
  preferenceKey: "a-office-mon-thu",
  rowIcon: "🧑",
  rowLabel: "Office",
  origin: HAUPTBAHNHOF,
  destination: ALEXANDERPLATZ,
  schedule: [
    {
      applicableDays: ["mon", "tue", "wed", "thu"],
      arriveByLocalTime: "09:30",
    },
  ],
};

// Same person, Friday — different origin (gym, not home), and the user
// declared they want a 15-minute "be ready by" anchor across this whole
// preference. The Friday rule narrows the visibility window to 30 min and
// explicitly clears the inherited bus exclusion (allowed today).
const A_OFFICE_FRIDAY: Preference = {
  preferenceKey: "a-office-fri",
  rowIcon: "🧑",
  rowLabel: "Office (Fri)",
  origin: LEHRTER_STR,
  destination: ALEXANDERPLATZ,
  preparationMinutes: 15,
  excludedLineNames: ["FEX"], // never want the airport express
  schedule: [
    {
      applicableDays: ["fri"],
      arriveByLocalTime: "10:00",
      windowLeadMinutesOverride: 30, // narrower window on Fri
      excludedLineNamesOverride: [], // override to nothing — bus is fine
    },
  ],
};

// Same person, evening home commute. Origin/destination are the office and
// home stops, swapped relative to the morning. One rule per active workday.
const A_HOME_WEEKDAY: Preference = {
  preferenceKey: "a-home-weekday",
  rowIcon: "🧑",
  rowLabel: "Home",
  origin: ALEXANDERPLATZ,
  destination: HAUPTBAHNHOF,
  schedule: [
    {
      applicableDays: "weekday",
      arriveByLocalTime: "19:00",
    },
  ],
};

// Person B — different commute, different days, different exclusions.
// Studio session twice a week and on Saturdays.
const B_STUDIO: Preference = {
  preferenceKey: "b-studio",
  rowIcon: "👩",
  rowLabel: "Studio",
  origin: HAUPTBAHNHOF,
  destination: SCHOENEWEIDE,
  excludedLineNames: ["BUS"], // refuses bus options for this commute
  schedule: [
    {
      applicableDays: ["tue", "thu"],
      arriveByLocalTime: "10:00",
    },
    {
      applicableDays: ["sat"],
      arriveByLocalTime: "13:00",
      // Saturday is sleepier — let the late tail stretch.
      windowLateTailMinutesOverride: 30,
    },
  ],
};

export const ROUTES: RoutesConfig = {
  preferences: [
    A_OFFICE_WEEKDAY,
    A_OFFICE_FRIDAY,
    A_HOME_WEEKDAY,
    B_STUDIO,
  ],
};
