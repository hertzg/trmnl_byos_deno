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
    },
  ],
};

Deno.test("nextApplicableArriveBy skips past arrive-by, returns next day", () => {
  // Monday 2025-11-10 09:31 Berlin — past today's 09:30. Expect Tuesday 09:30.
  const now = new Date("2025-11-10T08:31:00Z");
  const result = nextApplicableArriveBy(WEEKDAY_OFFICE.schedule, WEEKDAY_OFFICE, now);
  assert(result, "expected a result");
  assertEquals(result.arriveByDate.toISOString(), "2025-11-11T08:30:00.000Z");
});

Deno.test("nextApplicableArriveBy returns null when no rule fires within 7 days", () => {
  const sundayOnly: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [
      // Slice 1 only handles explicit day lists.
      { applicableDays: ["sun"], arriveByLocalTime: "10:00" },
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
