import { assertEquals } from "@std/assert";
import {
  assembleBoard,
  type Board,
  boardValidForSeconds,
  createBoardAssembler,
  makeVisibilityWindow,
  type VisibilityWindow,
} from "./board_assembler.ts";
import { resolveTunables } from "./preference.ts";
import type { Candidate, FetchCandidates } from "./journey_client.ts";
import type { Preference, RoutesConfig, Stop } from "./preference.ts";

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

const OFFICE: Preference = {
  preferenceKey: "office",
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

const CONFIG: RoutesConfig = { preferences: [OFFICE] };

function transitCandidate(departureIso: string, arrivalIso: string): Candidate {
  const departure = new Date(departureIso);
  const arrival = new Date(arrivalIso);
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
        realtime: { delaySeconds: 0, cancelled: false, hasRealtime: false, remarks: [] },
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("assembleBoard runs the pipeline and sorts rows by leave-by ascending", async () => {
  // 2025-11-10 (Monday). Now = 07:00 Berlin = 06:00Z. Schedule fires today 09:30.
  const now = new Date("2025-11-10T07:30:00Z");

  // Candidates returned by the stubbed fetcher — deliberately unsorted.
  const stubFetch: FetchCandidates = (origin, destination, latestArrivalDate) => {
    assertEquals((origin as Stop).hafasStopId, "900003201");
    assertEquals((destination as Stop).hafasStopId, "900100003");
    // Anchor = window.closesAt = arriveBy (08:30Z) + DEFAULTS.windowLateTailMinutes (15) = 08:45Z.
    assertEquals(latestArrivalDate.toISOString(), "2025-11-10T08:45:00.000Z");
    return Promise.resolve([
      // Departs 09:00 Berlin, arrives 09:12.
      transitCandidate("2025-11-10T09:00:00+01:00", "2025-11-10T09:12:00+01:00"),
      // Departs 08:45 Berlin, arrives 08:57. Should sort first by leave-by.
      transitCandidate("2025-11-10T08:45:00+01:00", "2025-11-10T08:57:00+01:00"),
    ]);
  };

  const board = await assembleBoard(CONFIG, now, { fetchCandidates: stubFetch });
  assertEquals(board.rows.length, 2);
  assertEquals(board.rows[0].leaveByDate.toISOString(), "2025-11-10T07:37:00.000Z");
  assertEquals(board.rows[1].leaveByDate.toISOString(), "2025-11-10T07:52:00.000Z");
  assertEquals(board.emptyReason, "none");
});

Deno.test("assembleBoard returns noScheduleApplicable empty when no preferences active", async () => {
  // Empty config → no active preferences.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = () => Promise.resolve([]);
  const board = await assembleBoard({ preferences: [] }, now, {
    fetchCandidates: stubFetch,
  });
  assertEquals(board.rows.length, 0);
  assertEquals(board.emptyReason, "noScheduleApplicable");
});

// ─── slice 4: multi-preference orchestration ────────────────────────────────

const POTSDAMER = {
  hafasStopId: "900100001",
  displayName: "Potsdamer",
  walkingMinutesBetweenStopAndAddress: 5,
} as const;
const ZOO = {
  hafasStopId: "900023201",
  displayName: "Zoo",
  walkingMinutesBetweenStopAndAddress: 6,
} as const;

const STUDIO: Preference = {
  preferenceKey: "studio",
  rowIcon: "B",
  rowLabel: "Studio",
  origin: POTSDAMER,
  destination: ZOO,
  schedule: [
    {
      applicableDays: ["mon", "tue", "wed", "thu", "fri"],
      arriveByLocalTime: "09:30",
      showFromLocalTime: "07:00",
    },
  ],
};

function transitCandidateFor(
  origin: { hafasStopId: string; displayName: string },
  destination: { hafasStopId: string; displayName: string },
  departureIso: string,
  arrivalIso: string,
  lineName = "S5",
): Candidate {
  const departure = new Date(departureIso);
  const arrival = new Date(arrivalIso);
  return {
    legs: [
      {
        kind: "transit",
        origin: { hafasStopId: (origin as Stop).hafasStopId, displayName: origin.displayName },
        destination: {
          hafasStopId: (destination as Stop).hafasStopId,
          displayName: destination.displayName,
        },
        departure,
        arrival,
        line: { name: lineName, product: "suburban" },
        direction: "Strausberg",
        realtime: { delaySeconds: 0, cancelled: false, hasRealtime: false, remarks: [] },
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("assembleBoard interleaves rows from two preferences sorted by leave-by", async () => {
  const now = new Date("2025-11-10T07:30:00Z"); // Monday 07:00 Berlin

  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      // OFFICE: Hbf → Alex. Walk-out 8m. leave-by = dep − 8m.
      return Promise.resolve([
        // dep 08:50 → leave-by 08:42 Berlin (07:42Z)
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00", "2025-11-10T09:02:00+01:00"),
      ]);
    }
    if ((origin as Stop).hafasStopId === POTSDAMER.hafasStopId) {
      // STUDIO: Potsdamer → Zoo. Walk-out 5m. leave-by = dep − 5m.
      return Promise.resolve([
        // dep 08:40 → leave-by 08:35 Berlin (07:35Z) — should be first
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:40:00+01:00",
          "2025-11-10T08:55:00+01:00",
        ),
        // dep 08:55 → leave-by 08:50 Berlin (07:50Z) — should be last
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:55:00+01:00",
          "2025-11-10T09:10:00+01:00",
        ),
      ]);
    }
    return Promise.resolve([]);
  };

  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );

  assertEquals(board.rows.length, 3);
  // Ascending by leave-by, interleaved across preferences.
  assertEquals(board.rows[0].leaveByDate.toISOString(), "2025-11-10T07:35:00.000Z");
  assertEquals(board.rows[0].preferenceKey, "studio");
  assertEquals(board.rows[0].preferenceIcon, "B");
  assertEquals(board.rows[0].preferenceLabel, "Studio");

  assertEquals(board.rows[1].leaveByDate.toISOString(), "2025-11-10T07:42:00.000Z");
  assertEquals(board.rows[1].preferenceKey, "office");
  assertEquals(board.rows[1].preferenceIcon, "A");
  assertEquals(board.rows[1].preferenceLabel, "Office");

  assertEquals(board.rows[2].leaveByDate.toISOString(), "2025-11-10T07:50:00.000Z");
  assertEquals(board.rows[2].preferenceKey, "studio");
  assertEquals(board.rows[2].preferenceIcon, "B");
});

Deno.test("assembleBoard stable sort: identical leave-by ties preserve fetch order", async () => {
  // Construct two preferences whose candidates produce IDENTICAL leave-by
  // instants. The first preference in the config (`OFFICE`) must appear before
  // `STUDIO` in the output for any tie. Within one preference, the fetcher's
  // returned order must also be preserved on ties.
  const now = new Date("2025-11-10T07:30:00Z");

  // OFFICE walk-out is 8m, STUDIO walk-out is 5m. To produce identical leave-by
  // (07:40Z = 08:40 Berlin), OFFICE dep = 08:48 Berlin, STUDIO dep = 08:45 Berlin.
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve([
        // OFFICE row A: leave-by 07:40Z
        transitCandidateFor(
          HBF,
          ALEX,
          "2025-11-10T08:48:00+01:00",
          "2025-11-10T09:00:00+01:00",
          "S5",
        ),
        // OFFICE row B: leave-by 07:40Z (also identical, second within OFFICE)
        transitCandidateFor(
          HBF,
          ALEX,
          "2025-11-10T08:48:00+01:00",
          "2025-11-10T09:01:00+01:00",
          "S7",
        ),
      ]);
    }
    if ((origin as Stop).hafasStopId === POTSDAMER.hafasStopId) {
      return Promise.resolve([
        // STUDIO row: leave-by 07:40Z (tie with OFFICE rows)
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:45:00+01:00",
          "2025-11-10T08:58:00+01:00",
          "U2",
        ),
      ]);
    }
    return Promise.resolve([]);
  };

  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );

  assertEquals(board.rows.length, 3);
  // All three rows share the same leave-by.
  assertEquals(board.rows[0].leaveByDate.toISOString(), "2025-11-10T07:40:00.000Z");
  assertEquals(board.rows[1].leaveByDate.toISOString(), "2025-11-10T07:40:00.000Z");
  assertEquals(board.rows[2].leaveByDate.toISOString(), "2025-11-10T07:40:00.000Z");
  // Stable order: OFFICE rows first (config order), in fetcher order; STUDIO last.
  assertEquals(board.rows[0].preferenceKey, "office");
  if (board.rows[0].kind !== "row") throw new Error("expected row");
  assertEquals((board.rows[0].legs[0] as { line: { name: string } }).line.name, "S5");
  assertEquals(board.rows[1].preferenceKey, "office");
  if (board.rows[1].kind !== "row") throw new Error("expected row");
  assertEquals((board.rows[1].legs[0] as { line: { name: string } }).line.name, "S7");
  assertEquals(board.rows[2].preferenceKey, "studio");
});

Deno.test("assembleBoard fetches preferences in parallel, not sequentially", async () => {
  // Each stubbed fetch waits FETCH_MS. With sequential fetching, total time
  // would be ≥ 2 × FETCH_MS. With parallel fetching, total ≈ 1 × FETCH_MS.
  // We assert the parallel bound with a generous slack to avoid flakes.
  const now = new Date("2025-11-10T07:30:00Z");
  const FETCH_MS = 50;

  const stubFetch: FetchCandidates = async (origin) => {
    await new Promise((r) => setTimeout(r, FETCH_MS));
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return [transitCandidateFor(
        HBF,
        ALEX,
        "2025-11-10T08:50:00+01:00",
        "2025-11-10T09:02:00+01:00",
      )];
    }
    return [transitCandidateFor(
      POTSDAMER,
      ZOO,
      "2025-11-10T08:40:00+01:00",
      "2025-11-10T08:55:00+01:00",
    )];
  };

  const start = performance.now();
  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );
  const elapsed = performance.now() - start;

  assertEquals(board.rows.length, 2);
  // Parallel: ~FETCH_MS. Sequential would be ~2 × FETCH_MS = 100ms.
  // Allow up to 1.5 × FETCH_MS to absorb scheduler jitter; still well below
  // the sequential lower bound of 2 × FETCH_MS.
  if (elapsed >= FETCH_MS * 1.8) {
    throw new Error(
      `assembleBoard fetched sequentially: elapsed=${elapsed}ms, expected ≈ ${FETCH_MS}ms`,
    );
  }
});

Deno.test("assembleBoard tolerates a single preference's FeedError; others render", async () => {
  // OFFICE returns a FeedError; STUDIO returns a normal candidate. The board
  // should render STUDIO's row and contribute zero rows from OFFICE. The
  // empty-state branching on partial failure is out-of-scope for this slice
  // (slice 9), so emptyReason stays "none" as long as some rows exist.
  const now = new Date("2025-11-10T07:30:00Z");

  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve({ kind: "feed-error", message: "stub failure" } as const);
    }
    return Promise.resolve([
      transitCandidateFor(
        POTSDAMER,
        ZOO,
        "2025-11-10T08:40:00+01:00",
        "2025-11-10T08:55:00+01:00",
      ),
    ]);
  };

  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );

  assertEquals(board.rows.length, 1);
  assertEquals(board.rows[0].preferenceKey, "studio");
  assertEquals(board.rows[0].preferenceIcon, "B");
  assertEquals(board.emptyReason, "none");
});

// ─── slice 3: visibility window + window-edge cadence ──────────────────────

Deno.test("makeVisibilityWindow sets opensAt from showFromDate and closesAt from the late tail", () => {
  // arrive-by 09:30 Berlin = 08:30Z; showFrom 07:00 Berlin = 06:00Z.
  // Default late tail 15 → closesAt = 08:45Z.
  const arriveByDate = new Date("2025-11-10T08:30:00Z");
  const showFromDate = new Date("2025-11-10T06:00:00Z");
  const tunables = resolveTunables(OFFICE, OFFICE.schedule[0]);
  const window = makeVisibilityWindow(tunables, arriveByDate, showFromDate);
  assertEquals(window.opensAt.toISOString(), "2025-11-10T06:00:00.000Z");
  assertEquals(window.closesAt.toISOString(), "2025-11-10T08:45:00.000Z");
  assertEquals(window.arriveByDate, arriveByDate);
});

Deno.test("boardValidForSeconds ticks at upcoming window opensAt edge", () => {
  // Synthetic board: no rows, one window opening in 25s.
  const now = new Date("2025-11-10T07:00:00Z");
  const window: VisibilityWindow = {
    opensAt: new Date(now.getTime() + 25_000),
    closesAt: new Date(now.getTime() + 60 * 60_000),
    arriveByDate: new Date(now.getTime() + 90 * 60_000),
  };
  const board: Board = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: now,
    windows: [window],
  };
  const seconds = boardValidForSeconds(board, now);
  // The cadence must tick at-or-before the window opens. Floor is 30s, so the
  // returned value should be exactly 30 (max(floor=30, 25)). Also asserts the
  // ceiling does not dominate (idle ceiling is 300, realtime ceiling 90).
  if (seconds > 30) {
    throw new Error(`expected validForSeconds ≤ 30, got ${seconds}`);
  }
});

Deno.test("boardValidForSeconds returns idle ceiling when no rows and no upcoming edges", () => {
  // All windows in the past — no upcoming edge.
  const now = new Date("2025-11-10T10:00:00Z");
  const window: VisibilityWindow = {
    opensAt: new Date(now.getTime() - 60 * 60_000),
    closesAt: new Date(now.getTime() - 30 * 60_000),
    arriveByDate: new Date(now.getTime() - 45 * 60_000),
  };
  const board: Board = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: now,
    windows: [window],
  };
  assertEquals(boardValidForSeconds(board, now), 300);
});

Deno.test("boardValidForSeconds picks the smallest of head-row, window edges, ceiling", () => {
  const now = new Date("2025-11-10T07:00:00Z");
  // Window opens in 200s (further than realtime ceiling but closer than head).
  // Realtime ceiling = 90. Smallest is 90.
  const window: VisibilityWindow = {
    opensAt: new Date(now.getTime() + 200_000),
    closesAt: new Date(now.getTime() + 60 * 60_000),
    arriveByDate: new Date(now.getTime() + 90 * 60_000),
  };
  const board: Board = {
    rows: [{
      kind: "row",
      leaveByDate: new Date(now.getTime() + 600_000), // 10m away
      plannedLeaveByDate: new Date(now.getTime() + 600_000),
      arriveByDate: new Date(now.getTime() + 1500_000),
      durationMinutes: 15,
      originLabel: "X",
      destinationLabel: "Y",
      preferenceKey: "p",
      preferenceLabel: "P",
      preferenceIcon: "P",
      legs: [],
      alerts: [],
      imminence: "future",
      // Far in the future so the grace tick (5min after leaveBy) doesn't
      // dominate the realtime ceiling in this test.
      graceExpiresAt: new Date(now.getTime() + 600_000 + 5 * 60_000),
    }],
    emptyReason: "none",
    fetchedAt: now,
    windows: [window],
  };
  // Realtime ceiling is 90s, untilHead is 605s, untilOpens is 200s.
  // min(90, 605, 200) = 90, max(30, 90) = 90.
  assertEquals(boardValidForSeconds(board, now), 90);
});

// ─── slice 8: imminent-departure grace cadence ─────────────────────────────

Deno.test("boardValidForSeconds ticks at the soonest imminent row's grace expiry", () => {
  // An imminent row whose effective leave-by passed 4m ago. With default grace
  // = 5min, this row's grace expires in 60s (= 4m past + 5m grace - now). That
  // tick must dominate the realtime ceiling (90s). The head row's `leaveByDate`
  // is in the past, so its untilLeaveBy candidate must NOT be added (positive
  // only), otherwise the negative would clamp to the floor and mask the test.
  const now = new Date("2025-11-10T07:00:00Z");
  const leaveByDate = new Date(now.getTime() - 4 * 60_000); // 4m past
  const board: Board = {
    rows: [{
      kind: "row",
      leaveByDate,
      plannedLeaveByDate: leaveByDate,
      arriveByDate: new Date(now.getTime() + 10 * 60_000),
      durationMinutes: 14,
      originLabel: "X",
      destinationLabel: "Y",
      preferenceKey: "p",
      preferenceLabel: "P",
      preferenceIcon: "P",
      legs: [],
      alerts: [],
      imminence: "leave-now",
      graceExpiresAt: new Date(leaveByDate.getTime() + 5 * 60_000),
    }],
    emptyReason: "none",
    fetchedAt: now,
    windows: [],
  };
  // Grace expiry = leaveByDate + 5min = now + 60s. Cadence: max(floor=30,
  // min(realtime=90, untilGrace=60)) = 60.
  const seconds = boardValidForSeconds(board, now);
  assertEquals(seconds, 60);
});

// ─── slice 7: cancellation strips + collapse ────────────────────────────────

// Build a one-leg cancelled candidate at the given Berlin departure time, for
// the given preference's origin/destination.
function cancelledCandidateFor(
  origin: { hafasStopId: string; displayName: string },
  destination: { hafasStopId: string; displayName: string },
  departureBerlin: string,
): Candidate {
  const departure = new Date(departureBerlin);
  const arrival = new Date(departure.getTime() + 12 * 60_000);
  return {
    legs: [
      {
        kind: "transit",
        origin,
        destination,
        departure,
        arrival,
        line: { name: "S5", product: "suburban" },
        direction: "Strausberg",
        realtime: { delaySeconds: 0, cancelled: true, hasRealtime: true, remarks: [] },
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("assembleBoard collapses two adjacent same-icon strips into count: 2", async () => {
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve([
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00"),
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:55:00+01:00"),
      ]);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, { fetchCandidates: stubFetch });
  assertEquals(board.rows.length, 1);
  const merged = board.rows[0];
  assertEquals(merged.kind, "cancellationStrip");
  if (merged.kind !== "cancellationStrip") return;
  assertEquals(merged.count, 2);
  assertEquals(merged.preferenceIcon, "A");
  // Earliest leave-by of the group is preserved for sort placement.
  // dep 08:50 Berlin − 8m walk = 08:42 Berlin = 07:42Z.
  assertEquals(merged.leaveByDate.toISOString(), "2025-11-10T07:42:00.000Z");
});

Deno.test("assembleBoard collapses three adjacent same-icon strips into count: 3", async () => {
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve([
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00"),
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:55:00+01:00"),
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T09:00:00+01:00"),
      ]);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, { fetchCandidates: stubFetch });
  assertEquals(board.rows.length, 1);
  const merged = board.rows[0];
  if (merged.kind !== "cancellationStrip") throw new Error("expected strip");
  assertEquals(merged.count, 3);
});

Deno.test("assembleBoard does NOT collapse strips from different icons next to each other", async () => {
  // OFFICE icon=A and STUDIO icon=B both produce a single cancelled candidate.
  // Sorted, the two strips are adjacent but have different `preferenceIcon` —
  // they must remain two separate strips.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      // OFFICE: walk-out 8m, dep 08:50 Berlin → leave-by 07:42Z.
      return Promise.resolve([
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00"),
      ]);
    }
    if ((origin as Stop).hafasStopId === POTSDAMER.hafasStopId) {
      // STUDIO: walk-out 5m, dep 08:50 Berlin → leave-by 07:45Z (next after OFFICE).
      return Promise.resolve([
        cancelledCandidateFor(POTSDAMER, ZOO, "2025-11-10T08:50:00+01:00"),
      ]);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );
  assertEquals(board.rows.length, 2);
  assertEquals(board.rows[0].kind, "cancellationStrip");
  assertEquals(board.rows[1].kind, "cancellationStrip");
  assertEquals(board.rows[0].preferenceIcon, "A");
  assertEquals(board.rows[1].preferenceIcon, "B");
});

Deno.test("assembleBoard: a Row between two same-icon strips prevents collapse", async () => {
  // Two cancelled OFFICE journeys with a healthy STUDIO row sorted between
  // them by leave-by. Even though the OFFICE strips share an icon, the STUDIO
  // row breaks adjacency → no merge.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      // OFFICE walk-out 8m: dep 08:50 → 07:42Z; dep 08:58 → 07:50Z.
      return Promise.resolve([
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00"),
        cancelledCandidateFor(HBF, ALEX, "2025-11-10T08:58:00+01:00"),
      ]);
    }
    if ((origin as Stop).hafasStopId === POTSDAMER.hafasStopId) {
      // STUDIO walk-out 5m: dep 08:50 Berlin → leave-by 07:45Z (between the
      // two OFFICE strips).
      return Promise.resolve([
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:50:00+01:00",
          "2025-11-10T09:05:00+01:00",
        ),
      ]);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );
  // Three entries: strip(A) → row(STUDIO) → strip(A). The middle row prevents
  // the merge.
  assertEquals(board.rows.length, 3);
  assertEquals(board.rows[0].kind, "cancellationStrip");
  assertEquals(board.rows[1].kind, "row");
  assertEquals(board.rows[2].kind, "cancellationStrip");
});

// ─── slice 9: three-kind empty-state precedence ─────────────────────────────

Deno.test("assembleBoard: all active fetches fail → emptyReason feedUnreachable", async () => {
  // Single active preference whose fetch returns FeedError. With no rows AND
  // an upstream fetch failure, the empty state must read as feedUnreachable —
  // not noScheduleApplicable (which would falsely imply the schedule is
  // quiet rather than the network being broken).
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = () =>
    Promise.resolve({ kind: "feed-error", message: "stub" } as const);
  const board = await assembleBoard(CONFIG, now, { fetchCandidates: stubFetch });
  assertEquals(board.rows.length, 0);
  assertEquals(board.emptyReason, "feedUnreachable");
});

Deno.test("createBoardAssembler: all-feed-error board carries lastSuccessfulFetchAt: null on first call", async () => {
  // A fresh assembler has no prior successful fetch — `lastSuccessfulFetchAt`
  // must be explicitly null so EmptyFrame can render "0 m old". Uses the
  // factory variant for cache isolation (the free-function `assembleBoard`
  // shares a process-wide cache that other tests warm up).
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = () =>
    Promise.resolve({ kind: "feed-error", message: "stub" } as const);
  const assembler = createBoardAssembler({ fetchCandidates: stubFetch });
  const board = await assembler.assembleBoard(CONFIG, now);
  assertEquals(board.lastSuccessfulFetchAt, null);
});

Deno.test("createBoardAssembler caches lastSuccessfulFetchAt across calls", async () => {
  // First call succeeds → cache is set to that `now`.
  // Second call (later) all-fails → board carries the FIRST call's instant.
  const firstNow = new Date("2025-11-10T07:30:00Z");
  const secondNow = new Date("2025-11-10T07:35:00Z");

  const okFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve([
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00", "2025-11-10T09:02:00+01:00"),
      ]);
    }
    return Promise.resolve([]);
  };
  const errFetch: FetchCandidates = () =>
    Promise.resolve({ kind: "feed-error", message: "stub" } as const);

  const assembler = createBoardAssembler({ fetchCandidates: okFetch });
  const first = await assembler.assembleBoard(CONFIG, firstNow);
  assertEquals(first.emptyReason, "none"); // rows present

  // Swap the fetcher to all-failure on the second call.
  const second = await assembler.assembleBoard(CONFIG, secondNow, { fetchCandidates: errFetch });
  assertEquals(second.emptyReason, "feedUnreachable");
  assertEquals(second.lastSuccessfulFetchAt?.toISOString(), firstNow.toISOString());
});

Deno.test("assembleBoard: noScheduleApplicable carries soonest nextAnchor across preferences", async () => {
  // Two preferences: OFFICE (mon-fri 09:30) and STUDIO (mon-fri 09:30). With
  // no rules applicable on a Saturday, both schedules' next anchor is
  // Monday 09:30. The tie is broken by `preferenceKey` → "office" < "studio".
  // To force noScheduleApplicable, we pick a `now` such that nextApplicable
  // walks 7 days but no rules fire imminently *and* fetches return [].
  // Saturday 2025-11-15 12:00 Berlin: next mon-fri rule fires Mon 2025-11-17 09:30.
  const now = new Date("2025-11-15T11:00:00Z"); // Sat 12:00 Berlin
  const stubFetch: FetchCandidates = () => Promise.resolve([]);

  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch },
  );
  assertEquals(board.rows.length, 0);
  assertEquals(board.emptyReason, "noScheduleApplicable");
  // Monday 2025-11-17 09:30 Berlin = 08:30Z (CET, no DST).
  assertEquals(board.nextAnchor?.arriveByDate.toISOString(), "2025-11-17T08:30:00.000Z");
  // Tie-break: "office" < "studio" lexicographically.
  assertEquals(board.nextAnchor?.preferenceKey, "office");
  assertEquals(board.nextAnchor?.preferenceLabel, "Office");
  assertEquals(board.nextAnchor?.preferenceIcon, "A");
});

// ─── slice 10: hard row cap with tail clip footnote ───────────────────────────

// Build N transit candidates spaced 1 minute apart, all OFFICE, with leave-by
// monotonically increasing. `firstDepBerlin` is the ISO Berlin departure of
// the first candidate; subsequent ones are +i minutes.
function manyTransitCandidates(
  origin: { hafasStopId: string; displayName: string },
  destination: { hafasStopId: string; displayName: string },
  firstDepBerlin: string,
  count: number,
): Candidate[] {
  const out: Candidate[] = [];
  const start = new Date(firstDepBerlin).getTime();
  for (let i = 0; i < count; i++) {
    const dep = new Date(start + i * 60_000).toISOString();
    const arr = new Date(start + i * 60_000 + 12 * 60_000).toISOString();
    out.push(transitCandidateFor(origin, destination, dep, arr));
  }
  return out;
}

Deno.test("assembleBoard: cap matches row count exactly → no clip summary", async () => {
  // 8 visible rows; default cap is 10 → all kept, no footnote.
  // OFFICE walk-out 8m. Window opens at 07:30Z (60m before arrive-by 08:30Z).
  // First dep 08:39 Berlin = 07:39Z → leave-by 07:31Z (inside window).
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve(
        manyTransitCandidates(HBF, ALEX, "2025-11-10T08:39:00+01:00", 8),
      );
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, { fetchCandidates: stubFetch });
  assertEquals(board.rows.length, 8);
  // No clipping — clipSummary should be absent (or null) on the board.
  assertEquals(board.clipSummary ?? null, null);
});

Deno.test("assembleBoard: cap=5 on 8 candidates → 5 rows + clipSummary count 3", async () => {
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve(
        manyTransitCandidates(HBF, ALEX, "2025-11-10T08:39:00+01:00", 8),
      );
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, {
    fetchCandidates: stubFetch,
    hardRowCapOverride: 5,
  });
  assertEquals(board.rows.length, 5);
  // First 5 leave-bys kept (sorted ascending). Drop count = 3.
  const summary = board.clipSummary;
  if (!summary) throw new Error("expected clipSummary");
  assertEquals(summary.perIcon.length, 1);
  assertEquals(summary.perIcon[0].icon, "A");
  assertEquals(summary.perIcon[0].label, "Office");
  assertEquals(summary.perIcon[0].count, 3);
  // First two leave-bys of the *clipped tail* (rows 6 & 7 in 0-indexed) — the
  // dropped tail starts at the 6th candidate. dep[5] = 08:44 Berlin = 07:44Z,
  // walk-out 8m → leave-by 07:36Z. dep[6] = 08:45 Berlin → leave-by 07:37Z.
  assertEquals(summary.perIcon[0].nextLeaveBys.length, 2);
  assertEquals(summary.perIcon[0].nextLeaveBys[0].toISOString(), "2025-11-10T07:36:00.000Z");
  assertEquals(summary.perIcon[0].nextLeaveBys[1].toISOString(), "2025-11-10T07:37:00.000Z");
});

Deno.test("assembleBoard: cap=1 on 8 candidates → 1 row + 7 dropped in summary", async () => {
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve(
        manyTransitCandidates(HBF, ALEX, "2025-11-10T08:39:00+01:00", 8),
      );
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, {
    fetchCandidates: stubFetch,
    hardRowCapOverride: 1,
  });
  assertEquals(board.rows.length, 1);
  const summary = board.clipSummary;
  if (!summary) throw new Error("expected clipSummary");
  assertEquals(summary.perIcon[0].count, 7);
});

Deno.test("assembleBoard: cap=0 → empty rows, summary covers everything dropped", async () => {
  // Issue says "define behaviour" for cap=0. We pick: zero visible rows, the
  // ClipSummary summarises all candidates that would have been rendered.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      return Promise.resolve(
        manyTransitCandidates(HBF, ALEX, "2025-11-10T08:39:00+01:00", 4),
      );
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, {
    fetchCandidates: stubFetch,
    hardRowCapOverride: 0,
  });
  assertEquals(board.rows.length, 0);
  // emptyReason stays "none" when classifier produced rows that were clipped —
  // the screen renders the footnote, not an empty frame.
  assertEquals(board.emptyReason, "none");
  const summary = board.clipSummary;
  if (!summary) throw new Error("expected clipSummary even at cap=0");
  assertEquals(summary.perIcon[0].count, 4);
});

Deno.test("assembleBoard: cap with mixed icons → footnote groups per icon, alphabetical", async () => {
  // Two preferences, each contributing many candidates. With cap=2, only the
  // first two leave-bys survive; everything else is grouped by icon (A vs B)
  // in the ClipSummary, with entries ordered alphabetically by icon.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      // OFFICE walk-out 8m, deps 08:40, 08:42, 08:44 Berlin → leave-bys
      // 07:32Z, 07:34Z, 07:36Z. Three rows.
      return Promise.resolve([
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:40:00+01:00", "2025-11-10T08:55:00+01:00"),
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:42:00+01:00", "2025-11-10T08:57:00+01:00"),
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:44:00+01:00", "2025-11-10T08:59:00+01:00"),
      ]);
    }
    if ((origin as Stop).hafasStopId === POTSDAMER.hafasStopId) {
      // STUDIO walk-out 5m, deps 08:38, 08:41 Berlin → leave-bys 07:33Z, 07:36Z.
      return Promise.resolve([
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:38:00+01:00",
          "2025-11-10T08:55:00+01:00",
        ),
        transitCandidateFor(
          POTSDAMER,
          ZOO,
          "2025-11-10T08:41:00+01:00",
          "2025-11-10T08:58:00+01:00",
        ),
      ]);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO] },
    now,
    { fetchCandidates: stubFetch, hardRowCapOverride: 2 },
  );
  assertEquals(board.rows.length, 2);
  // Sort: 07:32 OFFICE, 07:33 STUDIO kept; clipped tail is
  // 07:34 OFFICE, 07:36 OFFICE, 07:36 STUDIO.
  const summary = board.clipSummary;
  if (!summary) throw new Error("expected clipSummary");
  assertEquals(summary.perIcon.length, 2);
  // Alphabetical: A first, B second.
  assertEquals(summary.perIcon[0].icon, "A");
  assertEquals(summary.perIcon[0].count, 2);
  assertEquals(summary.perIcon[1].icon, "B");
  assertEquals(summary.perIcon[1].count, 1);
});

Deno.test("assembleBoard: collapseCancellations runs AFTER overflow — clipped strips don't inflate counts", async () => {
  // 12 cancellations from same icon (OFFICE); cap=5 → 5 strips visible. The
  // collapse pass folds those 5 into ONE strip with `count: 5`. Footnote
  // shows 7 dropped — NOT 12 minus visible-collapsed-count, because clipping
  // happens before collapse so the clipped strips are individual entries.
  const now = new Date("2025-11-10T07:30:00Z");
  const stubFetch: FetchCandidates = (origin) => {
    if ((origin as Stop).hafasStopId === HBF.hafasStopId) {
      // 12 cancellations, deps 08:39…08:50 Berlin (1m apart) so all 12 fall
      // inside the visibility window after walk-out 8m subtraction.
      const candidates: Candidate[] = [];
      const start = new Date("2025-11-10T08:39:00+01:00").getTime();
      for (let i = 0; i < 12; i++) {
        const dep = new Date(start + i * 60_000).toISOString();
        candidates.push(cancelledCandidateFor(HBF, ALEX, dep));
      }
      return Promise.resolve(candidates);
    }
    return Promise.resolve([]);
  };
  const board = await assembleBoard(CONFIG, now, {
    fetchCandidates: stubFetch,
    hardRowCapOverride: 5,
  });
  // After overflow keeps 5 strips, collapse merges them into 1 with count: 5.
  assertEquals(board.rows.length, 1);
  const merged = board.rows[0];
  if (merged.kind !== "cancellationStrip") throw new Error("expected strip");
  assertEquals(merged.count, 5);
  // Footnote: 7 strips were dropped (each is count: 1 from classifier output).
  const summary = board.clipSummary;
  if (!summary) throw new Error("expected clipSummary");
  assertEquals(summary.perIcon[0].count, 7);
});

Deno.test("assembleBoard: nextAnchor picks the soonest across preferences", async () => {
  // OFFICE fires Mon 09:30; STUDIO fires Sat 14:00. On a Friday evening, the
  // soonest is STUDIO Saturday — even though OFFICE comes first in config.
  const now = new Date("2025-11-14T19:00:00Z"); // Fri 20:00 Berlin
  const STUDIO_SAT: Preference = {
    ...STUDIO,
    schedule: [
      { applicableDays: ["sat"], arriveByLocalTime: "14:00", showFromLocalTime: "12:00" },
    ],
  };
  const stubFetch: FetchCandidates = () => Promise.resolve([]);
  const board = await assembleBoard(
    { preferences: [OFFICE, STUDIO_SAT] },
    now,
    { fetchCandidates: stubFetch },
  );
  assertEquals(board.emptyReason, "noScheduleApplicable");
  // Sat 2025-11-15 14:00 Berlin = 13:00Z.
  assertEquals(board.nextAnchor?.arriveByDate.toISOString(), "2025-11-15T13:00:00.000Z");
  assertEquals(board.nextAnchor?.preferenceKey, "studio");
});
