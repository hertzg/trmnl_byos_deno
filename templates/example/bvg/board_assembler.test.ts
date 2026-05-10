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
