import { assertEquals } from "@std/assert";
import { classify } from "./journey_classifier.ts";
import type { Candidate } from "./journey_client.ts";
import type { Preference } from "./preference.ts";
import { resolveTunables } from "./preference.ts";

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
    { applicableDays: ["mon", "tue", "wed", "thu", "fri"], arriveByLocalTime: "09:30" },
  ],
};

const SINGLE_TRANSIT_CANDIDATE: Candidate = {
  legs: [
    {
      kind: "transit",
      origin: { hafasStopId: "900003201", displayName: "Berlin Hauptbahnhof" },
      destination: { hafasStopId: "900100003", displayName: "Berlin Alexanderplatz" },
      departure: new Date("2025-11-10T08:00:00+01:00"),
      arrival: new Date("2025-11-10T08:12:00+01:00"),
      line: { name: "S5", product: "suburban" },
      direction: "Strausberg",
    },
  ],
  departure: new Date("2025-11-10T08:00:00+01:00"),
  arrival: new Date("2025-11-10T08:12:00+01:00"),
};

Deno.test("classify produces a Row with leave-by, arrive-by and stop labels", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const row = classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now);
  if (!row) throw new Error("expected a row");
  assertEquals(row.kind, "row");
  // Leave-by = first-leg departure − origin.walkingMinutes (8).
  assertEquals(row.leaveByDate.toISOString(), "2025-11-10T06:52:00.000Z");
  // Arrive-by = last-leg arrival + destination.walkingMinutes (4).
  assertEquals(row.arriveByDate.toISOString(), "2025-11-10T07:16:00.000Z");
  assertEquals(row.originLabel, "Hbf");
  assertEquals(row.destinationLabel, "Alex");
  assertEquals(row.preferenceLabel, "Office");
  assertEquals(row.preferenceIcon, "A");
  assertEquals(row.preferenceKey, "weekday-office");
  assertEquals(row.legs, SINGLE_TRANSIT_CANDIDATE.legs);
});
