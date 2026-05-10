// JourneyClassifier — turns a `Candidate` into a `BoardRow` for one active
// preference.
//
// Current scope: `Row` only — leave-by, arrive-by, leg list, the labels the
// row caption displays, and exclusion filtering against the resolved
// `excludedLineNames` deny-list. No realtime, no cancellation, no window check.

import type { Candidate, Leg } from "./journey_client.ts";
import type { Preference, ResolvedTunables } from "./preference.ts";

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
};

// `BoardRow` is the union of all row-shaped things. Slice 1 only emits `Row`;
// `CancellationStrip` arrives in slice 7.
export type BoardRow = Row;

export function classify(
  candidate: Candidate,
  activePreference: Preference,
  resolvedTunables: ResolvedTunables,
  _now: Date,
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

  const walkOutMs = activePreference.origin.walkingMinutesBetweenStopAndAddress * 60_000;
  const walkInMs = activePreference.destination.walkingMinutesBetweenStopAndAddress * 60_000;

  // Effective leave-by: first transit leg's planned departure + its realtime
  // delay, then walked back by the origin walk. If the journey is walking-only
  // (no transit leg), there's nothing to delay — fall back to firstLeg.
  const firstTransit = candidate.legs.find((l): l is typeof l & { kind: "transit" } =>
    l.kind === "transit"
  );
  const anchorLeg = firstTransit ?? firstLeg;
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

  const alerts = buildAlerts(candidate.legs);

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
  };
}

// Below this many seconds we don't bother surfacing the delay — the user can't
// act on sub-minute drift and the visual noise isn't worth it.
const DELAY_ALERT_FLOOR_SECONDS = 60;

// HAFAS severity strings considered worth surfacing as a ⚠ pill. "hint" is
// noisy informational stuff (low priority, "wagon 1 has X"); "warning" and
// "status" are real disruption signals.
const SURFACEABLE_REMARK_SEVERITIES: readonly string[] = ["warning", "status"];

// Remark text longer than this is shown elided. Tuned so a pill still fits in
// the leave-by column without wrapping more than two lines on the e-ink panel.
const REMARK_TEXT_MAX_CHARS = 60;

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
    alerts.push({ kind: "delay", text: `+${minutes}m delay` });
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
