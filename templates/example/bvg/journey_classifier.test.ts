import { assertEquals } from "@std/assert";
import { classify } from "./journey_classifier.ts";
import type { Candidate, Leg } from "./journey_client.ts";
import type { Preference, ResolvedTunables } from "./preference.ts";
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

// ─── exclusion filtering (slice 5) ──────────────────────────────────────────

const transitLeg = (
  lineName: string,
  departure: string,
  arrival: string,
): Leg => ({
  kind: "transit",
  origin: { hafasStopId: "x", displayName: "X" },
  destination: { hafasStopId: "y", displayName: "Y" },
  departure: new Date(departure),
  arrival: new Date(arrival),
  line: { name: lineName, product: "suburban" },
  direction: "Anywhere",
});

const walkingLeg = (departure: string, arrival: string): Leg => ({
  kind: "walking",
  origin: { hafasStopId: "x", displayName: "X" },
  destination: { hafasStopId: "y", displayName: "Y" },
  departure: new Date(departure),
  arrival: new Date(arrival),
  durationMinutes: Math.round(
    (new Date(arrival).getTime() - new Date(departure).getTime()) / 60_000,
  ),
});

function candidateOf(legs: readonly Leg[]): Candidate {
  return {
    legs,
    departure: legs[0].departure,
    arrival: legs[legs.length - 1].arrival,
  };
}

function tunablesWith(excludedLineNames: readonly string[]): ResolvedTunables {
  return {
    ...resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]),
    excludedLineNames,
  };
}

const NOW = new Date("2025-11-10T07:30:00+01:00");

type ExclusionCase = {
  name: string;
  legs: readonly Leg[];
  excludedLineNames: readonly string[];
  expectDropped: boolean;
};

const EXCLUSION_CASES: readonly ExclusionCase[] = [
  {
    name: "first leg in deny-list drops candidate",
    legs: [
      transitLeg("BUS", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
      transitLeg("S5", "2025-11-10T08:07:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: ["BUS"],
    expectDropped: true,
  },
  {
    name: "last leg in deny-list drops candidate",
    legs: [
      transitLeg("S5", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
      transitLeg("BUS", "2025-11-10T08:07:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: ["BUS"],
    expectDropped: true,
  },
  {
    name: "middle leg in deny-list drops candidate",
    legs: [
      transitLeg("S5", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
      transitLeg("BUS", "2025-11-10T08:07:00+01:00", "2025-11-10T08:10:00+01:00"),
      transitLeg("U2", "2025-11-10T08:12:00+01:00", "2025-11-10T08:18:00+01:00"),
    ],
    excludedLineNames: ["BUS"],
    expectDropped: true,
  },
  {
    // A walking leg has no `Line.name`, so even an exotic deny-list entry like
    // "" (which a buggy config could produce) must not match.
    name: "walking legs are never grounds for exclusion",
    legs: [
      walkingLeg("2025-11-10T08:00:00+01:00", "2025-11-10T08:02:00+01:00"),
      transitLeg("S5", "2025-11-10T08:03:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: ["", "WALK"],
    expectDropped: false,
  },
  {
    name: "empty exclusion list keeps everything",
    legs: [
      transitLeg("BUS", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
      transitLeg("S5", "2025-11-10T08:07:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: [],
    expectDropped: false,
  },
  {
    // Case-sensitive: BVG returns "BUS"; "bus" must NOT match.
    name: "case-sensitive: 'bus' does not match transit line 'BUS'",
    legs: [
      transitLeg("BUS", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
    ],
    excludedLineNames: ["bus"],
    expectDropped: false,
  },
  {
    name: "case-sensitive: 'BUS' matches transit line 'BUS'",
    legs: [
      transitLeg("BUS", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
    ],
    excludedLineNames: ["BUS"],
    expectDropped: true,
  },
  {
    name: "two transit legs, only one in deny-list, dropped (leg-level OR)",
    legs: [
      transitLeg("S5", "2025-11-10T08:00:00+01:00", "2025-11-10T08:05:00+01:00"),
      transitLeg("FEX", "2025-11-10T08:07:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: ["FEX"],
    expectDropped: true,
  },
  {
    name: "single transit leg whose line is not in deny-list, kept",
    legs: [
      transitLeg("S5", "2025-11-10T08:00:00+01:00", "2025-11-10T08:12:00+01:00"),
    ],
    excludedLineNames: ["BUS", "FEX"],
    expectDropped: false,
  },
];

for (const c of EXCLUSION_CASES) {
  Deno.test(`classify exclusion: ${c.name}`, () => {
    const tunables = tunablesWith(c.excludedLineNames);
    const result = classify(candidateOf(c.legs), WEEKDAY_OFFICE, tunables, NOW);
    if (c.expectDropped) {
      assertEquals(result, null);
    } else {
      if (!result) throw new Error("expected a row, got null");
      assertEquals(result.kind, "row");
    }
  });
}
