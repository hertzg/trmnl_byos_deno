import { assert, assertEquals } from "@std/assert";
import { nextApplicableArriveBy } from "./schedule_evaluator.ts";
import type { Preference } from "./preference.ts";

const HBF = {
  hafasStopId: "900003201",
  displayName: "Hbf",
  walkingMinutesBetweenStopAndAddress: 8,
} as const;
const ALEX = {
  hafasStopId: "900100003",
  displayName: "Alex",
  walkingMinutesBetweenStopAndAddress: 4,
} as const;

const WEEKDAY_OFFICE: Preference = {
  preferenceKey: "weekday-office",
  rowIcon: "A",
  rowLabel: "Office",
  origin: HBF,
  destination: ALEX,
  schedule: [
    {
      applicableDays: ["mon", "tue", "wed", "thu", "fri"],
      arriveByLocalTime: "09:30",
      showFromLocalTime: "07:00",
    },
  ],
};

Deno.test("nextApplicableArriveBy skips a rule once its late tail has passed", () => {
  // Monday 2025-11-10 09:46 Berlin (08:46Z) — past today's closesAt (09:30
  // arrive-by + default 15m late tail = 09:45). Expect Tuesday 09:30.
  const now = new Date("2025-11-10T08:46:00Z");
  const result = nextApplicableArriveBy(WEEKDAY_OFFICE.schedule, WEEKDAY_OFFICE, now);
  assert(result, "expected a result");
  assertEquals(result.arriveByDate.toISOString(), "2025-11-11T08:30:00.000Z");
});

Deno.test("nextApplicableArriveBy keeps today's rule current through its late tail", () => {
  // Monday 09:40 Berlin (08:40Z) — past the 09:30 arrive-by but still inside
  // the 09:45 closesAt. Today's rule must still be the resolution.
  const now = new Date("2025-11-10T08:40:00Z");
  const result = nextApplicableArriveBy(WEEKDAY_OFFICE.schedule, WEEKDAY_OFFICE, now);
  assert(result, "expected a result");
  assertEquals(result.arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");
});

Deno.test("nextApplicableArriveBy resolves showFromDate from the rule's showFromLocalTime", () => {
  const pref: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      { applicableDays: "all", arriveByLocalTime: "09:30", showFromLocalTime: "07:15" },
    ],
  };
  // Monday 2025-11-10 06:00 UTC = 07:00 Berlin (CET).
  const now = new Date("2025-11-10T06:00:00Z");
  const result = nextApplicableArriveBy(pref.schedule, pref, now);
  assert(result, "expected a result");
  // arrive-by 09:30 Berlin = 08:30Z; showFrom 07:15 Berlin = 06:15Z.
  assertEquals(result.arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");
  assertEquals(result.showFromDate.toISOString(), "2025-11-10T06:15:00.000Z");
});

Deno.test("nextApplicableArriveBy returns null when no rule fires within 7 days", () => {
  const sundayOnly: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      { applicableDays: ["sun"], arriveByLocalTime: "10:00", showFromLocalTime: "08:00" },
    ],
  };
  // Probe Monday — Sunday-only is fine, will fire next Sunday (within 7 days).
  const monday = new Date("2025-11-10T06:00:00Z");
  assert(nextApplicableArriveBy(sundayOnly.schedule, sundayOnly, monday));
  // But an empty schedule has no rules.
  assertEquals(
    nextApplicableArriveBy([], sundayOnly, monday),
    null,
  );
});

Deno.test(
  "nextApplicableArriveBy returns today's 09:30 Berlin when called early on a weekday",
  () => {
    // 2025-11-10 is a Monday. 06:00 UTC = 07:00 Berlin (CET, DST off).
    const now = new Date("2025-11-10T06:00:00Z");
    const result = nextApplicableArriveBy(WEEKDAY_OFFICE.schedule, WEEKDAY_OFFICE, now);
    assert(result, "expected a result");
    // 09:30 Berlin = 08:30 UTC in November (CET = UTC+1).
    assertEquals(result.arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");
    assertEquals(result.applicableRule, WEEKDAY_OFFICE.schedule[0]);
  },
);

Deno.test(
  "nextApplicableArriveBy interprets wall-clock correctly across DST forward",
  () => {
    // 2026-03-29 (Sun) is DST forward in Europe/Berlin: CET → CEST at 02:00.
    // From 03:00 onwards, Berlin is UTC+2; before, UTC+1.
    const pref: Preference = {
      ...WEEKDAY_OFFICE,
      schedule: [
        { applicableDays: "all", arriveByLocalTime: "09:30", showFromLocalTime: "07:00" },
      ],
    };
    // Sat 2026-03-28 06:00 UTC = 07:00 Berlin (CET) → today's 09:30 Berlin = 08:30 UTC.
    const beforeJump = new Date("2026-03-28T06:00:00Z");
    const sat = nextApplicableArriveBy(pref.schedule, pref, beforeJump);
    assert(sat);
    assertEquals(sat.arriveByDate.toISOString(), "2026-03-28T08:30:00.000Z");

    // Late on Sat after Saturday's closesAt (09:45) has passed → Sun 2026-03-29
    // 09:30 Berlin = 07:30 UTC (CEST = UTC+2 by then).
    const afterSatClose = new Date("2026-03-28T09:00:00Z");
    const dst = nextApplicableArriveBy(pref.schedule, pref, afterSatClose);
    assert(dst);
    assertEquals(dst.arriveByDate.toISOString(), "2026-03-29T07:30:00.000Z");
  },
);

Deno.test(
  "nextApplicableArriveBy interprets wall-clock correctly across DST backward",
  () => {
    // 2026-10-25 (Sun) is DST backward: CEST → CET at 03:00 (back to 02:00).
    const pref: Preference = {
      ...WEEKDAY_OFFICE,
      schedule: [
        { applicableDays: "all", arriveByLocalTime: "09:30", showFromLocalTime: "07:00" },
      ],
    };
    // Sat 2026-10-24 06:00 UTC = 08:00 Berlin (CEST) → today's 09:30 Berlin = 07:30 UTC.
    const beforeFall = new Date("2026-10-24T06:00:00Z");
    const sat = nextApplicableArriveBy(pref.schedule, pref, beforeFall);
    assert(sat);
    assertEquals(sat.arriveByDate.toISOString(), "2026-10-24T07:30:00.000Z");

    // Late on Sat → Sun 2026-10-25 09:30 Berlin = 08:30 UTC (CET = UTC+1 by then).
    const afterSatClose = new Date("2026-10-24T08:00:00Z");
    const dst = nextApplicableArriveBy(pref.schedule, pref, afterSatClose);
    assert(dst);
    assertEquals(dst.arriveByDate.toISOString(), "2026-10-25T08:30:00.000Z");
  },
);

Deno.test(
  "nextApplicableArriveBy week-wraps when only-match is in upcoming week",
  () => {
    // Saturday-only schedule probed on a Sunday → next Saturday (6 days later).
    const pref: Preference = {
      ...WEEKDAY_OFFICE,
      schedule: [
        { applicableDays: ["sat"], arriveByLocalTime: "11:00", showFromLocalTime: "09:00" },
      ],
    };
    // Sun 2025-11-09 12:00 UTC = 13:00 Berlin.
    const sunday = new Date("2025-11-09T12:00:00Z");
    const result = nextApplicableArriveBy(pref.schedule, pref, sunday);
    assert(result);
    // Sat 2025-11-15 11:00 Berlin = 10:00 UTC (CET).
    assertEquals(result.arriveByDate.toISOString(), "2025-11-15T10:00:00.000Z");
  },
);

Deno.test(
  "nextApplicableArriveBy returns soonest match across multiple rules in one schedule",
  () => {
    // Two rules that both match today; the earlier wall-clock wins.
    const pref: Preference = {
      ...WEEKDAY_OFFICE,
      schedule: [
        { applicableDays: "weekday", arriveByLocalTime: "14:00", showFromLocalTime: "12:00" },
        { applicableDays: "weekday", arriveByLocalTime: "09:30", showFromLocalTime: "07:00" },
      ],
    };
    // Mon 2025-11-10 06:00 UTC = 07:00 Berlin → 09:30 Berlin = 08:30 UTC wins.
    const monMorning = new Date("2025-11-10T06:00:00Z");
    const result = nextApplicableArriveBy(pref.schedule, pref, monMorning);
    assert(result);
    assertEquals(result.arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");
    assertEquals(result.applicableRule, pref.schedule[1]);

    // Same schedule but mid-afternoon: 09:30's late tail has passed; 14:00 ahead.
    const monAfternoon = new Date("2025-11-10T11:30:00Z"); // 12:30 Berlin
    const afternoon = nextApplicableArriveBy(pref.schedule, pref, monAfternoon);
    assert(afternoon);
    assertEquals(afternoon.arriveByDate.toISOString(), "2025-11-10T13:00:00.000Z");
    assertEquals(afternoon.applicableRule, pref.schedule[0]);
  },
);

Deno.test(
  "nextApplicableArriveBy breaks ties by rule order (first wins)",
  () => {
    const ruleA = {
      applicableDays: "weekday",
      arriveByLocalTime: "09:30",
      showFromLocalTime: "07:00",
    } as const;
    const ruleB = {
      applicableDays: "all",
      arriveByLocalTime: "09:30",
      showFromLocalTime: "07:00",
    } as const;
    const pref: Preference = { ...WEEKDAY_OFFICE, schedule: [ruleA, ruleB] };
    const monMorning = new Date("2025-11-10T06:00:00Z");
    const result = nextApplicableArriveBy(pref.schedule, pref, monMorning);
    assert(result);
    assertEquals(result.applicableRule, ruleA);
  },
);

Deno.test('nextApplicableArriveBy resolves "all" shorthand to every day', () => {
  const pref: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      { applicableDays: "all", arriveByLocalTime: "08:00", showFromLocalTime: "06:00" },
    ],
  };
  // Wed 2025-11-12 09:00 UTC = 10:00 Berlin → past 08:00 + late tail, expect Thu.
  const wed = new Date("2025-11-12T09:00:00Z");
  const result = nextApplicableArriveBy(pref.schedule, pref, wed);
  assert(result);
  assertEquals(result.arriveByDate.toISOString(), "2025-11-13T07:00:00.000Z");

  // Sun 2025-11-16 06:00 UTC → today's 08:00 Berlin still ahead (07:00 UTC).
  const sun = new Date("2025-11-16T06:00:00Z");
  const fromSun = nextApplicableArriveBy(pref.schedule, pref, sun);
  assert(fromSun);
  assertEquals(fromSun.arriveByDate.toISOString(), "2025-11-16T07:00:00.000Z");
});

Deno.test('nextApplicableArriveBy resolves "weekend" shorthand to sat-sun', () => {
  const pref: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      { applicableDays: "weekend", arriveByLocalTime: "10:00", showFromLocalTime: "08:00" },
    ],
  };
  // Friday 2025-11-14 06:00 UTC → Saturday 2025-11-15 10:00 Berlin = 09:00 UTC.
  const friday = new Date("2025-11-14T06:00:00Z");
  const result = nextApplicableArriveBy(pref.schedule, pref, friday);
  assert(result);
  assertEquals(result.arriveByDate.toISOString(), "2025-11-15T09:00:00.000Z");

  // Mid-Saturday 2025-11-15 11:00 UTC = 12:00 Berlin → Sunday 10:00 Berlin.
  const saturdayLate = new Date("2025-11-15T11:00:00Z");
  const fromSat = nextApplicableArriveBy(pref.schedule, pref, saturdayLate);
  assert(fromSat);
  assertEquals(fromSat.arriveByDate.toISOString(), "2025-11-16T09:00:00.000Z");
});

Deno.test('nextApplicableArriveBy resolves "weekday" shorthand to mon-fri', () => {
  const pref: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      { applicableDays: "weekday", arriveByLocalTime: "09:30", showFromLocalTime: "07:00" },
    ],
  };
  // Monday 2025-11-10 06:00 UTC = 07:00 Berlin → today's 09:30 Berlin = 08:30 UTC.
  const monday = new Date("2025-11-10T06:00:00Z");
  const result = nextApplicableArriveBy(pref.schedule, pref, monday);
  assert(result);
  assertEquals(result.arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");

  // Saturday 2025-11-15 06:00 UTC → no match Sat/Sun, next is Mon 2025-11-17 09:30 Berlin.
  const saturday = new Date("2025-11-15T06:00:00Z");
  const fromSat = nextApplicableArriveBy(pref.schedule, pref, saturday);
  assert(fromSat);
  assertEquals(fromSat.arriveByDate.toISOString(), "2025-11-17T08:30:00.000Z");
});
