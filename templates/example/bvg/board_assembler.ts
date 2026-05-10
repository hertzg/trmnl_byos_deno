// BoardAssembler — pipeline orchestrator.
//
//   resolveActive  →  fetchCandidates  →  classify  →  sort by leave-by
//
// The fetch dependency is injectable so the pipeline can be exercised
// integration-style with a stubbed client. In production, callers pass the
// real `fetchCandidates` from `./journey_client.ts`.
//
// Slice 1 scope: single preference, single rule, no exclusion, no realtime,
// no cancellation, no overflow cap, no window-edge cadence.

import {
  type Candidate,
  type FetchCandidates,
  fetchCandidates as defaultFetch,
} from "./journey_client.ts";
import { classify, type Row } from "./journey_classifier.ts";
import { resolveTunables, type RoutesConfig } from "./preference.ts";
import { nextApplicableArriveBy } from "./schedule_evaluator.ts";

// Reasons the row list might be empty. Slice 1 only distinguishes between
// "we have rows" and "no schedule fires right now"; `feedUnreachable` arrives
// in slice 7 alongside realtime + cancellation.
export type EmptyReason = "none" | "noScheduleApplicable" | "feedUnreachable";

export type Board = {
  rows: readonly Row[];
  emptyReason: EmptyReason;
  // Source-of-truth instant the board was assembled at. Used for the title
  // bar's "fetched at" stamp and for cadence math.
  fetchedAt: Date;
};

export type AssembleOptions = {
  fetchCandidates?: FetchCandidates;
};

export async function assembleBoard(
  config: RoutesConfig,
  now: Date,
  options: AssembleOptions = {},
): Promise<Board> {
  const fetchFn = options.fetchCandidates ?? defaultFetch;

  // Step 1 — resolve every preference; collect the active subset.
  const active: Array<{
    preference: typeof config.preferences[number];
    tunables: ReturnType<typeof resolveTunables>;
    arriveByDate: Date;
  }> = [];
  for (const preference of config.preferences) {
    const resolution = nextApplicableArriveBy(preference.schedule, preference, now);
    if (!resolution) continue;
    active.push({
      preference,
      tunables: resolveTunables(preference, resolution.applicableRule),
      arriveByDate: resolution.arriveByDate,
    });
  }

  // Step 2 — fetch all active preferences in parallel. Total wall-clock fetch
  // time is bounded by the slowest individual fetch, not their sum.
  const fetched = await Promise.all(
    active.map((a) => fetchFn(a.preference.origin, a.preference.destination, a.arriveByDate)),
  );

  // Step 3 — classify each preference's results independently. A `FeedError`
  // contributes zero rows but does not abort the others. (Slice 9 will branch
  // the empty-state on partial failure; this slice just tolerates it.)
  const rows: Row[] = [];
  for (let i = 0; i < active.length; i++) {
    const result = fetched[i];
    if (!Array.isArray(result)) continue;
    const { preference, tunables } = active[i];
    for (const candidate of result as readonly Candidate[]) {
      const row = classify(candidate, preference, tunables, now);
      if (row) rows.push(row);
    }
  }

  // Step 4 — stable sort by leave-by ascending. JS `Array.prototype.sort` is
  // required to be stable since ES2019, so ties preserve concatenation order
  // (which preserves fetch order, which preserves config order).
  rows.sort((a, b) => a.leaveByDate.getTime() - b.leaveByDate.getTime());

  return {
    rows,
    emptyReason: rows.length > 0 ? "none" : "noScheduleApplicable",
    fetchedAt: now,
  };
}

// `validForSeconds` shape per slice 1 — head-row tick + realtime ceiling +
// idle ceiling. No window-edge handling yet (slice 2/9).
export function boardValidForSeconds(board: Board, now: Date = new Date()): number {
  const FLOOR = 30;
  const REALTIME_CEIL = 90;
  const IDLE_CEIL = 300;
  const head = board.rows[0];
  if (!head) return IDLE_CEIL;
  const untilHead = Math.floor(
    (head.leaveByDate.getTime() - now.getTime()) / 1000,
  ) + 5;
  return Math.max(FLOOR, Math.min(REALTIME_CEIL, untilHead));
}
