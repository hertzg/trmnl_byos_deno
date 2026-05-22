// JourneyClassifier — turns a `Candidate` into a `BoardRow` for one active
// preference.
//
// Current scope: `Row` only — leave-by, arrive-by, leg list, the labels the
// row caption displays, and exclusion filtering against the resolved
// `excludedLineNames` deny-list. No realtime, no cancellation, no window check.

import type { VisibilityWindow } from "./board_assembler.ts";
import type { Candidate, Leg } from "./journey_client.ts";
import type { Place, Preference, ResolvedTunables, Stop } from "./preference.ts";

function isStop(p: Place): p is Stop {
  return "hafasStopId" in p;
}

// A single warning rendered as a ⚠ pill under the row's leave-by. Both delays
// and disruption remarks share this shape — they paint with the same visual
// treatment so the user only learns one alert vocabulary.
export type Alert = {
  kind: "delay" | "remark";
  text: string;
};

// One actionable journey rendered to the board.
export type Row = {
  kind: "row";
  // Sort key. The realtime-adjusted instant the user has to be out of the
  // door (planned leave-by + first-transit-leg delay).
  leaveByDate: Date;
  // What `leaveByDate` would have been without realtime. Equal to
  // `leaveByDate` when no realtime data, so the row component can compare to
  // decide whether to render a "was HH:MM" caption.
  plannedLeaveByDate: Date;
  // The instant the user actually walks in at the destination.
  arriveByDate: Date;
  // Trip duration in minutes (arriveByDate − leaveByDate). Pre-computed so the
  // row component doesn't repeat the math.
  durationMinutes: number;
  // Origin/destination short labels — `Stop.displayName` from the preference.
  originLabel: string;
  destinationLabel: string;
  // Preference the row belongs to.
  preferenceKey: string;
  preferenceLabel: string;
  preferenceIcon: string;
  // Verbatim leg list from the candidate, for the pictogram.
  legs: readonly Leg[];
  // Realtime-derived alerts (delays and surfaceable remarks). Empty list = no
  // pills. Cancellation handling is slice 7's problem.
  alerts: readonly Alert[];
  // Whether this row's effective leave-by has already passed (within the
  // imminent-departure grace window). `"leave-now"` = leave-by < now, still
  // within grace; `"future"` = leave-by ≥ now. The renderer paints
  // "leave-now" rows with hatched bg + "⚠ leave now" stamp.
  imminence: "leave-now" | "future";
  // Instant the imminent-grace window expires (= leaveBy + graceMinutes). Once
  // `now > graceExpiresAt` the row is dropped by the next render. Surfaced so
  // `BoardAssembler.boardValidForSeconds` can schedule a re-render at this tick.
  graceExpiresAt: Date;
};

// A thin "this preference's journey is cancelled" entry. Replaces a `Row` when
// any leg of the candidate has `realtime.cancelled === true`. Sorted into the
// row list by `leaveByDate` (the would-be effective leave-by) so the strip
// keeps the sort slot the cancelled journey would have occupied. The collapse
// pass in `BoardAssembler` folds runs of consecutive same-icon strips into a
// single entry by incrementing `count`.
export type CancellationStrip = {
  kind: "cancellationStrip";
  leaveByDate: Date;
  preferenceKey: string;
  preferenceLabel: string;
  preferenceIcon: string;
  count: number;
};

// `BoardRow` is the union of all row-shaped things. Slice 1 only emits `Row`;
// slice 7 adds `CancellationStrip`.
export type BoardRow = Row | CancellationStrip;

export function classify(
  candidate: Candidate,
  activePreference: Preference,
  resolvedTunables: ResolvedTunables,
  now: Date,
  window?: VisibilityWindow,
): BoardRow | null {
  const firstLeg = candidate.legs[0];
  const lastLeg = candidate.legs[candidate.legs.length - 1];
  if (!firstLeg || !lastLeg) return null;

  // Exclusion filtering. A candidate is dropped if any transit leg uses a line
  // whose name is in the deny-list. Walking legs (no `Line.name`) never trigger
  // exclusion. Comparison is case-sensitive — BVG returns canonical names like
  // "BUS", "S5", "FEX" and config authors are expected to match that casing.
  const denyList = resolvedTunables.excludedLineNames;
  if (denyList.length > 0) {
    for (const leg of candidate.legs) {
      if (leg.kind === "transit" && denyList.includes(leg.line.name)) {
        return null;
      }
    }
  }

  // Stop-based origins/destinations need the configured walking buffer between
  // the platform and the user's address; Address-based ones don't, because BVG
  // already returns a leading/trailing walking leg from/to the coordinates.
  const origin = activePreference.origin;
  const destination = activePreference.destination;
  const walkOutMs = isStop(origin) ? origin.walkingMinutesBetweenStopAndAddress * 60_000 : 0;
  const walkInMs = isStop(destination)
    ? destination.walkingMinutesBetweenStopAndAddress * 60_000
    : 0;

  // Departure anchor:
  //   Stop origin    → first transit leg's planned departure, walked back by
  //                    `walkOutMs` (BVG's response starts at the platform).
  //   Address origin → first leg's departure (= the walking leg from the
  //                    address that BVG returned), `walkOutMs` is 0.
  // Walking-only journeys have no transit leg to delay; fall back to firstLeg.
  const firstTransit = candidate.legs.find((l): l is typeof l & { kind: "transit" } =>
    l.kind === "transit"
  );
  const anchorLeg = isStop(origin) ? (firstTransit ?? firstLeg) : firstLeg;
  const plannedDepartureMs = anchorLeg.departure.getTime();
  const effectiveDelayMs = firstTransit && firstTransit.realtime.hasRealtime
    ? firstTransit.realtime.delaySeconds * 1000
    : 0;

  const plannedLeaveByDate = new Date(plannedDepartureMs - walkOutMs);
  const leaveByDate = new Date(plannedDepartureMs + effectiveDelayMs - walkOutMs);
  const arriveByDate = new Date(lastLeg.arrival.getTime() + walkInMs);
  const durationMinutes = Math.round(
    (arriveByDate.getTime() - leaveByDate.getTime()) / 60_000,
  );

  // Window check (slice 3). Runs AFTER leave-by/arrive-by are computed because
  // it compares those *effective* (realtime-adjusted, walk-shifted) instants —
  // not the raw leg times. The only bound is the upper one: a candidate is
  // surfaceable iff its `arriveByDate` is at or before `closesAt` (inclusive).
  // There is no early-arrival cutoff — the screen stays dark before `opensAt`
  // and once lit shows every catchable option; `opensAt` does not gate
  // per-candidate visibility.
  if (window && arriveByDate.getTime() > window.closesAt.getTime()) return null;

  // Past-leave-by drop (slice 3 + slice 8 grace). A row whose effective
  // leave-by is more than `imminentDepartureGraceMinutes` in the past is no
  // longer actionable and is dropped. Boundary policy: kept at exactly
  // `≤ graceMinutes` past, dropped at `> graceMinutes`.
  const graceMs = resolvedTunables.imminentDepartureGraceMinutes * 60_000;
  if (leaveByDate.getTime() < now.getTime() - graceMs) return null;

  // Cancellation routing (slice 7). If any leg flags realtime cancellation,
  // emit a thin `CancellationStrip` instead of a full `Row`. The strip carries
  // the would-be effective leave-by for sort placement; the assembler's
  // collapse pass folds consecutive same-icon strips into a count.
  for (const leg of candidate.legs) {
    if (leg.realtime.cancelled) {
      return {
        kind: "cancellationStrip",
        leaveByDate,
        preferenceKey: activePreference.preferenceKey,
        preferenceLabel: activePreference.rowLabel,
        preferenceIcon: activePreference.rowIcon,
        count: 1,
      };
    }
  }

  const alerts = buildAlerts(candidate.legs);

  // Imminence boundary: `leave-now` when `now − graceMinutes ≤ leaveBy < now`
  // (epsilon = 0, so leaveBy == now is `future`). Anything past grace is
  // already filtered out above; everything strictly before now is imminent.
  const imminence: "leave-now" | "future" = leaveByDate.getTime() < now.getTime()
    ? "leave-now"
    : "future";
  const graceExpiresAt = new Date(leaveByDate.getTime() + graceMs);

  return {
    kind: "row",
    leaveByDate,
    plannedLeaveByDate,
    arriveByDate,
    durationMinutes,
    originLabel: activePreference.origin.displayName,
    destinationLabel: activePreference.destination.displayName,
    preferenceKey: activePreference.preferenceKey,
    preferenceLabel: activePreference.rowLabel,
    preferenceIcon: activePreference.rowIcon,
    legs: candidate.legs,
    alerts,
    imminence,
    graceExpiresAt,
  };
}

// Below this many seconds we don't bother surfacing the delay — the user can't
// act on sub-minute drift and the visual noise isn't worth it.
const DELAY_ALERT_FLOOR_SECONDS = 60;

// HAFAS severity strings considered worth surfacing as a ⚠ pill. "hint" is
// noisy informational stuff (low priority, "wagon 1 has X"); "warning" and
// "status" are real disruption signals.
const SURFACEABLE_REMARK_SEVERITIES: readonly string[] = ["warning", "status"];

// Remark text longer than this is shown elided. The leave-by column wraps
// freely; this cap exists to bound truly pathological multi-paragraph remarks.
const REMARK_TEXT_MAX_CHARS = 200;

function truncateRemark(text: string): string {
  if (text.length <= REMARK_TEXT_MAX_CHARS) return text;
  return text.slice(0, REMARK_TEXT_MAX_CHARS - 1) + "…";
}

function buildAlerts(legs: readonly Leg[]): readonly Alert[] {
  const alerts: Alert[] = [];

  // Single combined delay alert: pick the largest delay across all transit
  // legs that have realtime data. If a leg's realtime data isn't live we
  // ignore its `delaySeconds` (defensive — see classify above).
  let maxDelaySeconds = 0;
  for (const leg of legs) {
    if (leg.kind !== "transit") continue;
    if (!leg.realtime.hasRealtime) continue;
    if (leg.realtime.delaySeconds > maxDelaySeconds) {
      maxDelaySeconds = leg.realtime.delaySeconds;
    }
  }
  if (maxDelaySeconds >= DELAY_ALERT_FLOOR_SECONDS) {
    const minutes = Math.floor(maxDelaySeconds / 60);
    alerts.push({ kind: "delay", text: `+${minutes}წთ დაგვიანება` });
  }

  // Remark alerts: one per surfaceable remark across all legs, in leg order.
  for (const leg of legs) {
    for (const remark of leg.realtime.remarks) {
      if (!SURFACEABLE_REMARK_SEVERITIES.includes(remark.severity)) continue;
      alerts.push({ kind: "remark", text: truncateRemark(remark.text) });
    }
  }

  return alerts;
}
