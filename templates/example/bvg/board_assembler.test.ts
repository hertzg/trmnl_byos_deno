import { assertEquals } from "@std/assert";
import { assembleBoard } from "./board_assembler.ts";
import type { Candidate, FetchCandidates } from "./journey_client.ts";
import type { Preference, RoutesConfig } from "./preference.ts";

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
    { applicableDays: ["mon", "tue", "wed", "thu", "fri"], arriveByLocalTime: "09:30" },
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
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("assembleBoard runs the pipeline and sorts rows by leave-by ascending", async () => {
  // 2025-11-10 (Monday). Now = 07:00 Berlin = 06:00Z. Schedule fires today 09:30.
  const now = new Date("2025-11-10T06:00:00Z");

  // Candidates returned by the stubbed fetcher — deliberately unsorted.
  const stubFetch: FetchCandidates = (origin, destination, arriveByDate) => {
    assertEquals(origin.hafasStopId, "900003201");
    assertEquals(destination.hafasStopId, "900100003");
    assertEquals(arriveByDate.toISOString(), "2025-11-10T08:30:00.000Z");
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
  const now = new Date("2025-11-10T06:00:00Z");
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
    { applicableDays: ["mon", "tue", "wed", "thu", "fri"], arriveByLocalTime: "09:30" },
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
        origin: { hafasStopId: origin.hafasStopId, displayName: origin.displayName },
        destination: {
          hafasStopId: destination.hafasStopId,
          displayName: destination.displayName,
        },
        departure,
        arrival,
        line: { name: lineName, product: "suburban" },
        direction: "Strausberg",
      },
    ],
    departure,
    arrival,
  };
}

Deno.test("assembleBoard interleaves rows from two preferences sorted by leave-by", async () => {
  const now = new Date("2025-11-10T06:00:00Z"); // Monday 07:00 Berlin

  const stubFetch: FetchCandidates = (origin) => {
    if (origin.hafasStopId === HBF.hafasStopId) {
      // OFFICE: Hbf → Alex. Walk-out 8m. leave-by = dep − 8m.
      return Promise.resolve([
        // dep 08:50 → leave-by 08:42 Berlin (07:42Z)
        transitCandidateFor(HBF, ALEX, "2025-11-10T08:50:00+01:00", "2025-11-10T09:02:00+01:00"),
      ]);
    }
    if (origin.hafasStopId === POTSDAMER.hafasStopId) {
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
  const now = new Date("2025-11-10T06:00:00Z");

  // OFFICE walk-out is 8m, STUDIO walk-out is 5m. To produce identical leave-by
  // (07:40Z = 08:40 Berlin), OFFICE dep = 08:48 Berlin, STUDIO dep = 08:45 Berlin.
  const stubFetch: FetchCandidates = (origin) => {
    if (origin.hafasStopId === HBF.hafasStopId) {
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
    if (origin.hafasStopId === POTSDAMER.hafasStopId) {
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
  assertEquals((board.rows[0].legs[0] as { line: { name: string } }).line.name, "S5");
  assertEquals(board.rows[1].preferenceKey, "office");
  assertEquals((board.rows[1].legs[0] as { line: { name: string } }).line.name, "S7");
  assertEquals(board.rows[2].preferenceKey, "studio");
});

Deno.test("assembleBoard fetches preferences in parallel, not sequentially", async () => {
  // Each stubbed fetch waits FETCH_MS. With sequential fetching, total time
  // would be ≥ 2 × FETCH_MS. With parallel fetching, total ≈ 1 × FETCH_MS.
  // We assert the parallel bound with a generous slack to avoid flakes.
  const now = new Date("2025-11-10T06:00:00Z");
  const FETCH_MS = 50;

  const stubFetch: FetchCandidates = async (origin) => {
    await new Promise((r) => setTimeout(r, FETCH_MS));
    if (origin.hafasStopId === HBF.hafasStopId) {
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
  const now = new Date("2025-11-10T06:00:00Z");

  const stubFetch: FetchCandidates = (origin) => {
    if (origin.hafasStopId === HBF.hafasStopId) {
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
