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
import {
  DEFAULTS,
  type ResolvedTunables,
  resolveTunables,
  type RoutesConfig,
} from "./preference.ts";
import { nextApplicableArriveBy } from "./schedule_evaluator.ts";

// VisibilityWindow — the per-active-preference time slot in which candidates
// are surfaceable. Asymmetric: long lead so the user can plan; short late
// tail because arriving late is more painful than arriving early.
//
// Co-located with `BoardAssembler` rather than `preference.ts` because a
// window is a derived state per render cycle, not configuration. The board
// assembler is the only producer; the classifier is the only consumer.
export type VisibilityWindow = {
  opensAt: Date;
  closesAt: Date;
  arriveByDate: Date;
};

export function makeVisibilityWindow(
  tunables: ResolvedTunables,
  arriveByDate: Date,
): VisibilityWindow {
  return {
    opensAt: new Date(arriveByDate.getTime() - tunables.windowLeadMinutes * 60_000),
    closesAt: new Date(arriveByDate.getTime() + tunables.windowLateTailMinutes * 60_000),
    arriveByDate,
  };
}

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
  // Per-active-preference visibility windows. Used by `boardValidForSeconds`
  // to schedule a re-render at each upcoming `opensAt` / `closesAt` crossing.
  windows: readonly VisibilityWindow[];
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

  // Step 1 — resolve every preference; collect the active subset, deriving
  // each preference's `VisibilityWindow` once per render cycle.
  const active: Array<{
    preference: typeof config.preferences[number];
    tunables: ResolvedTunables;
    arriveByDate: Date;
    window: VisibilityWindow;
  }> = [];
  for (const preference of config.preferences) {
    const resolution = nextApplicableArriveBy(preference.schedule, preference, now);
    if (!resolution) continue;
    const tunables = resolveTunables(preference, resolution.applicableRule);
    active.push({
      preference,
      tunables,
      arriveByDate: resolution.arriveByDate,
      window: makeVisibilityWindow(tunables, resolution.arriveByDate),
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
    const { preference, tunables, window } = active[i];
    for (const candidate of result as readonly Candidate[]) {
      const row = classify(candidate, preference, tunables, now, window);
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
    windows: active.map((a) => a.window),
  };
}

// `validForSeconds` shape (slice 3) — head-row tick + window-edge ticks +
// realtime ceiling, floored. With no rows AND no upcoming window edges we
// fall back to the idle ceiling.
//
// `DEFAULTS` is read directly here (rather than via `resolveTunables`) because
// the cadence policy is global, not per-preference: every active preference
// shares the same floor/ceiling. The board assembler is the documented owner
// of the cadence policy (see PRD "Refresh cadence").
export function boardValidForSeconds(board: Board, now: Date = new Date()): number {
  const FLOOR = DEFAULTS.refreshFloorSeconds;
  const REALTIME_CEIL = DEFAULTS.refreshRealtimeCeilingSeconds;
  const IDLE_CEIL = DEFAULTS.refreshIdleCeilingSeconds;

  const candidates: number[] = [REALTIME_CEIL];

  const head = board.rows[0];
  if (head) {
    // +5s slack absorbs the cycle's render/dispatch latency so the screen
    // re-renders just *after* the head row's leave-by passes, not just before.
    const untilHead = Math.floor((head.leaveByDate.getTime() - now.getTime()) / 1000) + 5;
    candidates.push(untilHead);
  }

  // Window-edge ticks: every positive `opensAt − now` and `closesAt − now`
  // across active preferences. Negative deltas (already-crossed edges) are
  // ignored — the next render cycle will pick up the next edge.
  for (const w of board.windows) {
    const untilOpens = Math.floor((w.opensAt.getTime() - now.getTime()) / 1000);
    if (untilOpens > 0) candidates.push(untilOpens);
    const untilCloses = Math.floor((w.closesAt.getTime() - now.getTime()) / 1000);
    if (untilCloses > 0) candidates.push(untilCloses);
  }

  // No rows AND no upcoming edges → idle ceiling.
  if (!head && candidates.length === 1) return IDLE_CEIL;

  return Math.max(FLOOR, Math.min(...candidates));
}
