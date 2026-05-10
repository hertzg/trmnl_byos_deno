import { assertEquals } from "@std/assert";
import type { VisibilityWindow } from "./board_assembler.ts";
import { type BoardRow, classify, type Row } from "./journey_classifier.ts";
import type { Candidate, Leg } from "./journey_client.ts";
import type { Preference, ResolvedTunables } from "./preference.ts";
import { resolveTunables } from "./preference.ts";

// Test helper: assert classifier returned a `Row` (not a `CancellationStrip`)
// and narrow the type for the rest of the test body. Throws if the result is
// null or a strip, so tests can keep accessing `row.alerts`/`row.legs`/etc.
function assertRow(result: BoardRow | null): Row {
  if (!result) throw new Error("expected a row, got null");
  if (result.kind !== "row") {
    throw new Error(`expected kind=row, got kind=${result.kind}`);
  }
  return result;
}

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

const EMPTY_RT = {
  delaySeconds: 0,
  cancelled: false,
  hasRealtime: false,
  remarks: [],
} as const;

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
      realtime: EMPTY_RT,
    },
  ],
  departure: new Date("2025-11-10T08:00:00+01:00"),
  arrival: new Date("2025-11-10T08:12:00+01:00"),
};

Deno.test("classify produces a Row with leave-by, arrive-by and stop labels", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const row = assertRow(classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now));
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

// ─── slice 6: realtime alerts ───────────────────────────────────────────────

Deno.test("classify: clean candidate has no alerts and plannedLeaveByDate == leaveByDate", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const row = assertRow(classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts, []);
  assertEquals(row.plannedLeaveByDate.getTime(), row.leaveByDate.getTime());
});

// Builds a single-transit candidate with the given realtime annotation on the
// only leg.
function transitCandidateWithRealtime(realtime: {
  delaySeconds: number;
  cancelled?: boolean;
  hasRealtime: boolean;
  remarks?: readonly { text: string; severity: string }[];
}): Candidate {
  const departure = new Date("2025-11-10T08:00:00+01:00");
  const arrival = new Date("2025-11-10T08:12:00+01:00");
  return {
    legs: [
      {
        kind: "transit",
        origin: { hafasStopId: "900003201", displayName: "Hbf" },
        destination: { hafasStopId: "900100003", displayName: "Alex" },
        departure,
        arrival,
        line: { name: "S5", product: "suburban" },
        direction: "Strausberg",
        realtime: {
          delaySeconds: realtime.delaySeconds,
          cancelled: realtime.cancelled ?? false,
          hasRealtime: realtime.hasRealtime,
          remarks: realtime.remarks ?? [],
        },
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("classify: effective leave-by shifts by delay when hasRealtime=true", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({ delaySeconds: 240, hasRealtime: true });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  // Planned: 08:00 − 8min walk = 07:52 Berlin = 06:52Z.
  assertEquals(row.plannedLeaveByDate.toISOString(), "2025-11-10T06:52:00.000Z");
  // Effective: 08:00 + 4min delay − 8min walk = 07:56 Berlin = 06:56Z.
  assertEquals(row.leaveByDate.toISOString(), "2025-11-10T06:56:00.000Z");
});

Deno.test("classify: hasRealtime=true but delaySeconds=0 → no shift, no alert", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({ delaySeconds: 0, hasRealtime: true });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.leaveByDate.getTime(), row.plannedLeaveByDate.getTime());
  assertEquals(row.alerts, []);
});

Deno.test("classify: hasRealtime=false leaves leave-by unshifted even if delaySeconds is set", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  // Defensive: a buggy upstream could send delaySeconds without flagging
  // realtime. Without the live-data signal we trust the schedule.
  const candidate = transitCandidateWithRealtime({ delaySeconds: 600, hasRealtime: false });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.leaveByDate.getTime(), row.plannedLeaveByDate.getTime());
});

Deno.test("classify: delay >= 60s emits a +Nm delay alert (rounded down to whole minutes)", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({ delaySeconds: 240, hasRealtime: true });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts.length, 1);
  assertEquals(row.alerts[0].kind, "delay");
  assertEquals(row.alerts[0].text, "+4m delay");
});

Deno.test("classify: delay < 60s does NOT emit a delay alert", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({ delaySeconds: 45, hasRealtime: true });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts, []);
});

Deno.test("classify: cancellation on first (only) leg → CancellationStrip, not Row", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    cancelled: true,
    hasRealtime: true,
  });
  const result = classify(candidate, WEEKDAY_OFFICE, tunables, now);
  if (!result) throw new Error("expected a result, got null");
  assertEquals(result.kind, "cancellationStrip");
  if (result.kind !== "cancellationStrip") return; // narrow
  // Strip carries the would-be effective leave-by for sort placement.
  // Effective leave-by: 08:00 Berlin − 8min walk = 07:52 Berlin = 06:52Z.
  assertEquals(result.leaveByDate.toISOString(), "2025-11-10T06:52:00.000Z");
  assertEquals(result.preferenceKey, "weekday-office");
  assertEquals(result.preferenceLabel, "Office");
  assertEquals(result.preferenceIcon, "A");
  assertEquals(result.count, 1);
});

// Build a multi-transit candidate, with `cancelled` flag set on a chosen leg
// position. Used by the slice 7 cancellation routing tests.
function multiTransitWithCancellationOn(position: "first" | "middle" | "last"): Candidate {
  const legs: Leg[] = [
    {
      kind: "transit",
      origin: { hafasStopId: "a", displayName: "A" },
      destination: { hafasStopId: "b", displayName: "B" },
      departure: new Date("2025-11-10T08:00:00+01:00"),
      arrival: new Date("2025-11-10T08:05:00+01:00"),
      line: { name: "S5", product: "suburban" },
      direction: "x",
      realtime: { delaySeconds: 0, cancelled: false, hasRealtime: true, remarks: [] },
    },
    {
      kind: "transit",
      origin: { hafasStopId: "b", displayName: "B" },
      destination: { hafasStopId: "c", displayName: "C" },
      departure: new Date("2025-11-10T08:08:00+01:00"),
      arrival: new Date("2025-11-10T08:12:00+01:00"),
      line: { name: "U2", product: "subway" },
      direction: "y",
      realtime: { delaySeconds: 0, cancelled: false, hasRealtime: true, remarks: [] },
    },
    {
      kind: "transit",
      origin: { hafasStopId: "c", displayName: "C" },
      destination: { hafasStopId: "d", displayName: "D" },
      departure: new Date("2025-11-10T08:14:00+01:00"),
      arrival: new Date("2025-11-10T08:18:00+01:00"),
      line: { name: "BUS", product: "bus" },
      direction: "z",
      realtime: { delaySeconds: 0, cancelled: false, hasRealtime: true, remarks: [] },
    },
  ];
  const idx = position === "first" ? 0 : position === "middle" ? 1 : 2;
  legs[idx] = {
    ...legs[idx],
    realtime: { ...legs[idx].realtime, cancelled: true },
  } as Leg;
  return { legs, departure: legs[0].departure, arrival: legs[2].arrival };
}

Deno.test("classify: cancellation on last leg → CancellationStrip", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const result = classify(
    multiTransitWithCancellationOn("last"),
    WEEKDAY_OFFICE,
    tunables,
    now,
  );
  if (!result) throw new Error("expected a result");
  assertEquals(result.kind, "cancellationStrip");
});

Deno.test("classify: cancellation on middle leg → CancellationStrip", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const result = classify(
    multiTransitWithCancellationOn("middle"),
    WEEKDAY_OFFICE,
    tunables,
    now,
  );
  if (!result) throw new Error("expected a result");
  assertEquals(result.kind, "cancellationStrip");
});

Deno.test("classify: cancelled candidate outside window is dropped (window check still applies)", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:00:00Z");
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    cancelled: true,
    hasRealtime: true,
  });
  // Effective leave-by 06:52Z; window opens AFTER it → dropped.
  const window: VisibilityWindow = {
    opensAt: new Date("2025-11-10T06:53:00Z"),
    closesAt: new Date("2025-11-10T09:00:00Z"),
    arriveByDate: new Date("2025-11-10T08:30:00Z"),
  };
  const result = classify(candidate, WEEKDAY_OFFICE, tunables, now, window);
  assertEquals(result, null);
});

Deno.test("classify: cancelled candidate hitting an excluded line is dropped", () => {
  // Cancelled BUS leg AND BUS is in the deny-list → exclusion wins, dropped
  // entirely. The exclusion check runs before cancellation routing.
  const tunables = tunablesWith(["BUS"]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const cand = multiTransitWithCancellationOn("last"); // last leg = BUS, cancelled
  const result = classify(cand, WEEKDAY_OFFICE, tunables, now);
  assertEquals(result, null);
});

Deno.test("classify: surfaceable remark (severity=warning) becomes a remark alert", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    hasRealtime: true,
    remarks: [{ text: "U2 lift OOS at Alex", severity: "warning" }],
  });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts.length, 1);
  assertEquals(row.alerts[0].kind, "remark");
  assertEquals(row.alerts[0].text, "U2 lift OOS at Alex");
});

Deno.test("classify: non-surfaceable remark (severity=hint) is filtered out", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    hasRealtime: true,
    remarks: [{ text: "Wagon 1 has limited mobility access", severity: "hint" }],
  });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts, []);
});

Deno.test("classify: long remark text is truncated", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  const longText = "A".repeat(400);
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    hasRealtime: true,
    remarks: [{ text: longText, severity: "warning" }],
  });
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  assertEquals(row.alerts.length, 1);
  // Truncation cap is 200 chars including ellipsis; total length stays bounded.
  if (row.alerts[0].text.length > 200) {
    throw new Error(`expected truncation, got ${row.alerts[0].text.length} chars`);
  }
});

Deno.test("classify: max delay across legs wins for the single delay alert", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T07:30:00+01:00");
  // Two transit legs: leg 1 +90s, leg 2 +300s. We emit ONE alert "+5m delay".
  const candidate: Candidate = {
    legs: [
      {
        kind: "transit",
        origin: { hafasStopId: "a", displayName: "A" },
        destination: { hafasStopId: "b", displayName: "B" },
        departure: new Date("2025-11-10T08:00:00+01:00"),
        arrival: new Date("2025-11-10T08:05:00+01:00"),
        line: { name: "S5", product: "suburban" },
        direction: "x",
        realtime: { delaySeconds: 90, cancelled: false, hasRealtime: true, remarks: [] },
      },
      {
        kind: "transit",
        origin: { hafasStopId: "b", displayName: "B" },
        destination: { hafasStopId: "c", displayName: "C" },
        departure: new Date("2025-11-10T08:08:00+01:00"),
        arrival: new Date("2025-11-10T08:14:00+01:00"),
        line: { name: "U2", product: "subway" },
        direction: "y",
        realtime: { delaySeconds: 300, cancelled: false, hasRealtime: true, remarks: [] },
      },
    ],
    departure: new Date("2025-11-10T08:00:00+01:00"),
    arrival: new Date("2025-11-10T08:14:00+01:00"),
  };
  const row = assertRow(classify(candidate, WEEKDAY_OFFICE, tunables, now));
  const delayAlerts = row.alerts.filter((a) => a.kind === "delay");
  assertEquals(delayAlerts.length, 1);
  assertEquals(delayAlerts[0].text, "+5m delay");
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
  realtime: EMPTY_RT,
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
  realtime: EMPTY_RT,
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

// ─── slice 3: visibility window ─────────────────────────────────────────────

// SINGLE_TRANSIT_CANDIDATE has effective leave-by 06:52Z and arrive-by 07:16Z.

type WindowCase = {
  name: string;
  window: VisibilityWindow;
  expectDropped: boolean;
};

const WINDOW_ARRIVE_BY = new Date("2025-11-10T08:30:00Z");

const WINDOW_CASES: readonly WindowCase[] = [
  {
    name: "just inside opensAt (opensAt < leave-by) → kept",
    window: {
      opensAt: new Date("2025-11-10T06:51:00Z"),
      closesAt: new Date("2025-11-10T09:00:00Z"),
      arriveByDate: WINDOW_ARRIVE_BY,
    },
    expectDropped: false,
  },
  {
    name: "on the boundary (opensAt == leave-by) → kept (inclusive)",
    window: {
      opensAt: new Date("2025-11-10T06:52:00Z"),
      closesAt: new Date("2025-11-10T09:00:00Z"),
      arriveByDate: WINDOW_ARRIVE_BY,
    },
    expectDropped: false,
  },
  {
    name: "just outside opensAt (opensAt > leave-by) → dropped",
    window: {
      opensAt: new Date("2025-11-10T06:53:00Z"),
      closesAt: new Date("2025-11-10T09:00:00Z"),
      arriveByDate: WINDOW_ARRIVE_BY,
    },
    expectDropped: true,
  },
  {
    name: "closesAt edge: closesAt == arrive-by → kept (inclusive)",
    window: {
      opensAt: new Date("2025-11-10T06:00:00Z"),
      closesAt: new Date("2025-11-10T07:16:00Z"),
      arriveByDate: WINDOW_ARRIVE_BY,
    },
    expectDropped: false,
  },
  {
    name: "closesAt edge: closesAt < arrive-by → dropped",
    window: {
      opensAt: new Date("2025-11-10T06:00:00Z"),
      closesAt: new Date("2025-11-10T07:15:00Z"),
      arriveByDate: WINDOW_ARRIVE_BY,
    },
    expectDropped: true,
  },
];

for (const c of WINDOW_CASES) {
  Deno.test(`classify window: ${c.name}`, () => {
    const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
    const now = new Date("2025-11-10T06:00:00Z");
    const result = classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, c.window);
    if (c.expectDropped) {
      assertEquals(result, null);
    } else {
      if (!result) throw new Error("expected a row, got null");
      assertEquals(result.kind, "row");
    }
  });
}

Deno.test("classify: candidate whose effective leave-by is past grace is dropped", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  // SINGLE_TRANSIT_CANDIDATE has effective leave-by = 06:52Z. Setting `now`
  // 6 minutes later (default grace = 5) puts the row past the imminent-grace
  // window — dropped. Within grace it would be kept as imminent (slice 8).
  const now = new Date("2025-11-10T06:58:00.001Z");
  const window: VisibilityWindow = {
    opensAt: new Date("2025-11-10T05:00:00Z"),
    closesAt: new Date("2025-11-10T09:00:00Z"),
    arriveByDate: new Date("2025-11-10T08:30:00Z"),
  };
  const result = classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, window);
  assertEquals(result, null);
});

Deno.test("classify: candidate whose effective leave-by equals now is kept", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:52:00Z");
  const window: VisibilityWindow = {
    opensAt: new Date("2025-11-10T05:00:00Z"),
    closesAt: new Date("2025-11-10T09:00:00Z"),
    arriveByDate: new Date("2025-11-10T08:30:00Z"),
  };
  const result = classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, window);
  if (!result) throw new Error("expected a row, got null");
  assertEquals(result.kind, "row");
});

// ─── slice 8: imminent-departure grace ─────────────────────────────────────

// SINGLE_TRANSIT_CANDIDATE has effective leave-by 06:52Z. We move `now` around
// that moment and assert the classifier's grace behaviour. Default grace is 5m.

const PERMISSIVE_WINDOW: VisibilityWindow = {
  opensAt: new Date("2025-11-10T05:00:00Z"),
  closesAt: new Date("2025-11-10T09:00:00Z"),
  arriveByDate: new Date("2025-11-10T08:30:00Z"),
};

Deno.test("classify imminence: leave-by 0min in past → kept, imminence=leave-now", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  // leave-by = 06:52Z; now = 06:52Z → exactly at leave-by, treated as imminent
  // because boundary is `leaveByDate < now + epsilon (0)`.
  const now = new Date("2025-11-10T06:52:00.001Z");
  const row = assertRow(
    classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, PERMISSIVE_WINDOW),
  );
  assertEquals(row.imminence, "leave-now");
});

Deno.test("classify imminence: leave-by 4min in past (default grace 5) → kept, imminent", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:56:00Z"); // 4m past leave-by
  const row = assertRow(
    classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, PERMISSIVE_WINDOW),
  );
  assertEquals(row.imminence, "leave-now");
});

Deno.test("classify imminence: leave-by exactly graceMinutes in past → kept, imminent (boundary)", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:57:00Z"); // exactly 5m past leave-by
  const row = assertRow(
    classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, PERMISSIVE_WINDOW),
  );
  assertEquals(row.imminence, "leave-now");
});

Deno.test("classify imminence: leave-by graceMinutes+1ms in past → dropped", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:57:00.001Z"); // 5m + 1ms past leave-by
  const result = classify(
    SINGLE_TRANSIT_CANDIDATE,
    WEEKDAY_OFFICE,
    tunables,
    now,
    PERMISSIVE_WINDOW,
  );
  assertEquals(result, null);
});

Deno.test("classify imminence: leave-by 1min in future → kept, imminence=future", () => {
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const now = new Date("2025-11-10T06:51:00Z"); // 1m before leave-by
  const row = assertRow(
    classify(SINGLE_TRANSIT_CANDIDATE, WEEKDAY_OFFICE, tunables, now, PERMISSIVE_WINDOW),
  );
  assertEquals(row.imminence, "future");
});

Deno.test("classify imminence: per-rule imminentDepartureGraceMinutesOverride is respected", () => {
  // Override grace to 10 minutes via rule override. leave-by 7m in past → kept,
  // imminent (would be dropped under default grace=5).
  const ruleWithGrace: typeof WEEKDAY_OFFICE.schedule[0] = {
    ...WEEKDAY_OFFICE.schedule[0],
    imminentDepartureGraceMinutesOverride: 10,
  };
  const prefWithRule: Preference = {
    ...WEEKDAY_OFFICE,
    schedule: [ruleWithGrace],
  };
  const tunables = resolveTunables(prefWithRule, ruleWithGrace);
  const now = new Date("2025-11-10T06:59:00Z"); // 7m past leave-by
  const row = assertRow(
    classify(SINGLE_TRANSIT_CANDIDATE, prefWithRule, tunables, now, PERMISSIVE_WINDOW),
  );
  assertEquals(row.imminence, "leave-now");
});

Deno.test("classify imminence: cancelled candidate at imminent leave-by still emits CancellationStrip", () => {
  // Cancellation routing must not be replaced by an imminent Row.
  const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
  const candidate = transitCandidateWithRealtime({
    delaySeconds: 0,
    cancelled: true,
    hasRealtime: true,
  });
  // leave-by = 06:52Z; now 3m past → in grace window, would be imminent if not cancelled.
  const now = new Date("2025-11-10T06:55:00Z");
  const result = classify(candidate, WEEKDAY_OFFICE, tunables, now, PERMISSIVE_WINDOW);
  if (!result) throw new Error("expected a result, got null");
  assertEquals(result.kind, "cancellationStrip");
});

// Low-frequency line simulation. Six candidates spread evenly through the
// hour before arrive-by (08:30Z). Narrowing the lead-time visibly reduces
// the surviving count.
Deno.test("classify: narrowing windowLeadMinutesOverride visibly reduces rows", () => {
  const arriveByDate = new Date("2025-11-10T08:30:00Z");
  // Earlier than every candidate's effective leave-by (06:52Z is the earliest).
  const now = new Date("2025-11-10T06:00:00Z");

  // Candidate departures (Berlin local times — 08:00..08:25 in 5m steps).
  // After WEEKDAY_OFFICE walk-out (8m) effective leave-by lands at:
  //   dep 08:00 → 06:52Z, 08:05 → 06:57Z, 08:10 → 07:02Z,
  //   dep 08:15 → 07:07Z, 08:20 → 07:12Z, 08:25 → 07:17Z
  const candidates: readonly Candidate[] = [
    "2025-11-10T08:00:00+01:00",
    "2025-11-10T08:05:00+01:00",
    "2025-11-10T08:10:00+01:00",
    "2025-11-10T08:15:00+01:00",
    "2025-11-10T08:20:00+01:00",
    "2025-11-10T08:25:00+01:00",
  ].map((dep) => ({
    legs: [{
      kind: "transit" as const,
      origin: { hafasStopId: "x", displayName: "X" },
      destination: { hafasStopId: "y", displayName: "Y" },
      departure: new Date(dep),
      arrival: new Date(new Date(dep).getTime() + 12 * 60_000),
      line: { name: "S5", product: "suburban" } as const,
      direction: "Anywhere",
      realtime: EMPTY_RT,
    }],
    departure: new Date(dep),
    arrival: new Date(new Date(dep).getTime() + 12 * 60_000),
  }));

  type Case = {
    leadMinutes: number;
    expectedSurvivors: number;
  };

  // arrive-by = 08:30Z. opensAt = 08:30Z − leadMinutes.
  //   lead=90: opensAt=07:00Z   → leave-bys ≥ 07:00Z survive (4)
  //   lead=60: opensAt=07:30Z   → leave-bys ≥ 07:30Z survive (0 — none)
  //   lead=40: opensAt=07:50Z   → 0
  //   lead=120: opensAt=06:30Z  → all 6
  //   lead=20: opensAt=08:10Z   → 0
  //
  // Use a generous late tail so closesAt doesn't disqualify late candidates
  // (we're isolating the lead-time effect).
  const cases: readonly Case[] = [
    { leadMinutes: 120, expectedSurvivors: 6 },
    { leadMinutes: 90, expectedSurvivors: 4 },
    { leadMinutes: 60, expectedSurvivors: 0 },
    { leadMinutes: 20, expectedSurvivors: 0 },
  ];

  for (const c of cases) {
    const window: VisibilityWindow = {
      opensAt: new Date(arriveByDate.getTime() - c.leadMinutes * 60_000),
      closesAt: new Date(arriveByDate.getTime() + 60 * 60_000),
      arriveByDate,
    };
    const tunables = resolveTunables(WEEKDAY_OFFICE, WEEKDAY_OFFICE.schedule[0]);
    let surviving = 0;
    for (const cand of candidates) {
      if (classify(cand, WEEKDAY_OFFICE, tunables, now, window)) surviving++;
    }
    assertEquals(
      surviving,
      c.expectedSurvivors,
      `lead=${c.leadMinutes} expected ${c.expectedSurvivors} got ${surviving}`,
    );
  }
});
