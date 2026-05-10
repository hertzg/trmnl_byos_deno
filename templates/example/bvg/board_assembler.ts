// BoardAssembler — pipeline orchestrator.
//
//   resolveActive  →  fetchCandidates  →  classify  →  sort by leave-by  →  collapse
//
// The fetch dependency is injectable so the pipeline can be exercised
// integration-style with a stubbed client. In production, callers pass the
// real `fetchCandidates` from `./journey_client.ts`.
//
// Slice 9: three-kind empty-state precedence (`none` / `feedUnreachable` /
// `noScheduleApplicable`) plus a `lastSuccessfulFetchAt` cache that survives
// across calls. The cache is held in a closure inside `createBoardAssembler`
// (factory variant). The free-function `assembleBoard` keeps a process-wide
// default assembler for callers that don't need their own cache.

import {
  type Candidate,
  type FetchCandidates,
  fetchCandidates as defaultFetch,
} from "./journey_client.ts";
import { type BoardRow, classify } from "./journey_classifier.ts";
import {
  DEFAULTS,
  type Preference,
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

// Reasons the row list might be empty. Three kinds:
//   "none"                 rows present, empty frame not rendered
//   "noScheduleApplicable" no preference is currently active and no fetch
//                          failed — the screen is genuinely quiet
//   "feedUnreachable"      at least one active preference's BVG fetch returned
//                          a FeedError and no rows survived
export type EmptyReason = "none" | "noScheduleApplicable" | "feedUnreachable";

// Hint surfaced in the `noScheduleApplicable` empty frame so the screen says
// when it'll be useful again. Computed by walking every preference's schedule
// (regardless of whether it was active for `now`) and picking the soonest
// future arrive-by; ties broken by `preferenceKey` for stability.
export type NextAnchor = {
  arriveByDate: Date;
  preferenceKey: string;
  preferenceLabel: string;
  preferenceIcon: string;
};

// ClipSummary — per-icon record of rows that were dropped by the hard row cap.
//
// One entry per `preferenceIcon` that had at least one clipped row. `count` is
// the total dropped for that icon; `nextLeaveBys` are the *first two* leave-by
// `Date`s of the clipped tail for that icon (i.e. the latest two surviving
// chronological options the user is missing), in ascending order.
//
// Order policy: entries are sorted by `icon` ascending lexicographic so the
// footnote reads alphabetically (`A: …  B: …`) regardless of fetch/sort order.
export type ClipSummary = {
  readonly perIcon: readonly {
    readonly icon: string;
    readonly label: string;
    readonly count: number;
    readonly nextLeaveBys: readonly Date[];
  }[];
};

export type Board = {
  rows: readonly BoardRow[];
  emptyReason: EmptyReason;
  // Populated when `applyOverflow` clipped rows from the tail. Absent / null
  // when nothing was clipped, so `EmptyFrame`-style code can branch on
  // truthiness.
  clipSummary?: ClipSummary | null;
  // Source-of-truth instant the board was assembled at. Used for the title
  // bar's "fetched at" stamp and for cadence math.
  fetchedAt: Date;
  // Per-active-preference visibility windows. Used by `boardValidForSeconds`
  // to schedule a re-render at each upcoming `opensAt` / `closesAt` crossing.
  windows: readonly VisibilityWindow[];
  // Only populated when `emptyReason === "feedUnreachable"`. The instant of
  // the most recent successful fetch across calls; `null` if no fetch has
  // ever succeeded since the assembler was created.
  lastSuccessfulFetchAt?: Date | null;
  // Only populated when `emptyReason === "noScheduleApplicable"`. The soonest
  // future arrive-by across all preferences — drives the empty frame's
  // "next: <weekday> <HH:MM> · <icon> · <label>" sub-text.
  nextAnchor?: NextAnchor;
};

export type AssembleOptions = {
  fetchCandidates?: FetchCandidates;
  // Test-time override for the hard row cap. Production callers leave this
  // unset; the assembler reads `DEFAULTS.hardRowCap` (per-preference cap is
  // out of scope for slice 10 — single global default).
  hardRowCapOverride?: number;
};

export type BoardAssembler = {
  assembleBoard(
    config: RoutesConfig,
    now: Date,
    options?: AssembleOptions,
  ): Promise<Board>;
};

// Factory variant. Holds the `lastSuccessfulFetchAt` cache in a closure so
// successive calls share state without exposing a class. Pick the factory
// over a closure-bound argument because the cache is internal lifecycle
// state, not a per-call input.
export function createBoardAssembler(defaults: AssembleOptions = {}): BoardAssembler {
  // Most-recent successful fetch instant across the assembler's lifetime.
  // `null` until the first non-FeedError fetch resolves.
  let lastSuccessfulFetchAt: Date | null = null;

  return {
    async assembleBoard(config, now, options = {}): Promise<Board> {
      const fetchFn = options.fetchCandidates ?? defaults.fetchCandidates ?? defaultFetch;

      // Step 1 — resolve every preference; collect the active subset.
      const active: Array<{
        preference: Preference;
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

      // Step 2 — fetch all active preferences in parallel.
      const fetched = await Promise.all(
        active.map((a) => fetchFn(a.preference.origin, a.preference.destination, a.arriveByDate)),
      );

      // Step 2a — update last-successful-fetch cache. Any successful (non
      // FeedError) result counts as success for cache purposes; partial
      // success still refreshes the timestamp.
      let anySuccess = false;
      let anyFeedError = false;
      for (const result of fetched) {
        if (Array.isArray(result)) anySuccess = true;
        else anyFeedError = true;
      }
      if (anySuccess) lastSuccessfulFetchAt = now;

      // Step 3 — classify each preference's results independently. A FeedError
      // contributes zero rows but does not abort others.
      const rows: BoardRow[] = [];
      for (let i = 0; i < active.length; i++) {
        const result = fetched[i];
        if (!Array.isArray(result)) continue;
        const { preference, tunables, window } = active[i];
        for (const candidate of result as readonly Candidate[]) {
          const row = classify(candidate, preference, tunables, now, window);
          if (row) rows.push(row);
        }
      }

      // Step 4 — stable sort by leave-by ascending. JS `Array.prototype.sort`
      // is required to be stable since ES2019, so ties preserve concatenation
      // order (which preserves fetch order, which preserves config order).
      rows.sort((a, b) => a.leaveByDate.getTime() - b.leaveByDate.getTime());

      // Step 5a — hard row cap: clip the tail (latest leave-bys) and produce a
      // per-icon ClipSummary. Runs BEFORE collapseCancellations so dropped
      // strips don't inflate collapse counts. Default cap source:
      // `DEFAULTS.hardRowCap` (per-preference override is out of scope here).
      const cap = options.hardRowCapOverride ?? defaults.hardRowCapOverride ?? DEFAULTS.hardRowCap;
      const { kept, clipSummary } = applyOverflow(rows, cap);

      // Step 5b — collapse runs of consecutive `CancellationStrip`s with the
      // same `preferenceIcon`. See `collapseCancellations` for details.
      const collapsedRows = collapseCancellations(kept);

      // Step 6 — empty-state precedence:
      //   1. rows present (or clipped to zero)  → none
      //   2. else any active fetch failed       → feedUnreachable
      //   3. else                               → noScheduleApplicable
      // Rows clipped to zero by the cap count as "rows present" — the frame
      // surfaces the footnote instead of an empty frame, since the screen has
      // something useful to say (and the schedule isn't quiet, just over cap).
      let emptyReason: EmptyReason;
      if (collapsedRows.length > 0 || rows.length > 0) emptyReason = "none";
      else if (anyFeedError) emptyReason = "feedUnreachable";
      else emptyReason = "noScheduleApplicable";

      const board: Board = {
        rows: collapsedRows,
        emptyReason,
        fetchedAt: now,
        windows: active.map((a) => a.window),
      };

      if (clipSummary) board.clipSummary = clipSummary;

      if (emptyReason === "feedUnreachable") {
        board.lastSuccessfulFetchAt = lastSuccessfulFetchAt;
      }

      if (emptyReason === "noScheduleApplicable") {
        const anchor = pickNextAnchor(config.preferences, now);
        if (anchor) board.nextAnchor = anchor;
      }

      return board;
    },
  };
}

// Walk every preference's schedule, materialise its next applicable arrive-by,
// and return the soonest. Ties (same `arriveByDate`) are broken by
// `preferenceKey` ascending lexicographic so the empty-state hint is stable
// across renders.
function pickNextAnchor(
  preferences: readonly Preference[],
  now: Date,
): NextAnchor | undefined {
  let best: NextAnchor | undefined;
  for (const preference of preferences) {
    const resolution = nextApplicableArriveBy(preference.schedule, preference, now);
    if (!resolution) continue;
    const candidate: NextAnchor = {
      arriveByDate: resolution.arriveByDate,
      preferenceKey: preference.preferenceKey,
      preferenceLabel: preference.rowLabel,
      preferenceIcon: preference.rowIcon,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const cmp = candidate.arriveByDate.getTime() - best.arriveByDate.getTime();
    if (cmp < 0 || (cmp === 0 && candidate.preferenceKey < best.preferenceKey)) {
      best = candidate;
    }
  }
  return best;
}

// Process-wide default assembler. Free-function callers (`assembleBoard`)
// share its `lastSuccessfulFetchAt` cache across all calls in the same
// process — which is exactly what `data.ts` needs (one server, one cache).
const DEFAULT_ASSEMBLER = createBoardAssembler();

export function assembleBoard(
  config: RoutesConfig,
  now: Date,
  options: AssembleOptions = {},
): Promise<Board> {
  return DEFAULT_ASSEMBLER.assembleBoard(config, now, options);
}

// Hard row cap with tail-clipping. Inputs are pre-sorted by leave-by ascending;
// keeping the first N preserves the most-imminent options the user actually
// needs. Dropped rows are folded into a per-icon `ClipSummary` so the footnote
// can tell the user how many "later" rows they aren't seeing.
//
// Behaviour at edge caps:
//   cap = 0  → no rows survive; ClipSummary summarises everything dropped.
//              (Defines behaviour per the issue's "cap = 0 → empty rows,
//              footnote summarises everything dropped" decision.)
//   cap ≥ N  → all rows kept; ClipSummary is `null`.
function applyOverflow(
  rows: readonly BoardRow[],
  cap: number,
): { kept: BoardRow[]; clipSummary: ClipSummary | null } {
  if (rows.length <= cap) {
    return { kept: rows.slice(), clipSummary: null };
  }
  const kept = rows.slice(0, Math.max(0, cap));
  const dropped = rows.slice(Math.max(0, cap));

  // Group dropped rows by preferenceIcon. Track the icon's label and the first
  // two leave-by Dates seen (the chronologically-earliest of the clipped tail).
  type Bucket = { icon: string; label: string; count: number; nextLeaveBys: Date[] };
  const byIcon = new Map<string, Bucket>();
  for (const row of dropped) {
    let bucket = byIcon.get(row.preferenceIcon);
    if (!bucket) {
      bucket = { icon: row.preferenceIcon, label: row.preferenceLabel, count: 0, nextLeaveBys: [] };
      byIcon.set(row.preferenceIcon, bucket);
    }
    bucket.count += row.kind === "cancellationStrip" ? row.count : 1;
    if (bucket.nextLeaveBys.length < 2) bucket.nextLeaveBys.push(row.leaveByDate);
  }

  // Order policy: alphabetical by icon ascending. The issue example
  // ("A: …  B: …") demonstrates this; keeps footnote stable across renders.
  const perIcon = [...byIcon.values()]
    .sort((a, b) => (a.icon < b.icon ? -1 : a.icon > b.icon ? 1 : 0))
    .map((b) => ({
      icon: b.icon,
      label: b.label,
      count: b.count,
      nextLeaveBys: b.nextLeaveBys.slice() as readonly Date[],
    }));

  return { kept, clipSummary: { perIcon } };
}

// Walk a sorted `BoardRow[]` and fold consecutive `CancellationStrip` entries
// that share `preferenceIcon` into one. The merged strip keeps the EARLIEST
// `leaveByDate` of the group (so it occupies the slot the first cancelled
// journey would have held) and sums `count`. Anything else (a `Row`, or a
// strip with a different icon) terminates the run.
function collapseCancellations(rows: readonly BoardRow[]): BoardRow[] {
  const out: BoardRow[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (
      row.kind === "cancellationStrip" &&
      last &&
      last.kind === "cancellationStrip" &&
      last.preferenceIcon === row.preferenceIcon
    ) {
      // Merge into the previous strip — leaveByDate already earliest by sort.
      out[out.length - 1] = { ...last, count: last.count + row.count };
      continue;
    }
    out.push(row);
  }
  return out;
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
    // Only added when positive — for imminent rows (leave-by already past) the
    // grace-expiry tick below carries the meaningful schedule instead.
    const untilHead = Math.floor((head.leaveByDate.getTime() - now.getTime()) / 1000) + 5;
    if (untilHead > 0) candidates.push(untilHead);
  }

  // Imminent-grace expiry ticks (slice 8): for every visible Row, schedule a
  // re-render at `leaveBy + graceMinutes` so the row drops the moment its
  // grace window closes. Cancellation strips have no grace concept. Positive
  // only — past expiries belong to rows that should already have been dropped.
  for (const row of board.rows) {
    if (row.kind !== "row") continue;
    const untilGrace = Math.floor((row.graceExpiresAt.getTime() - now.getTime()) / 1000);
    if (untilGrace > 0) candidates.push(untilGrace);
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
