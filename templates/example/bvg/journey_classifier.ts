// JourneyClassifier — turns a `Candidate` into a `BoardRow` for one active
// preference.
//
// Current scope: `Row` only — leave-by, arrive-by, leg list, the labels the
// row caption displays, and exclusion filtering against the resolved
// `excludedLineNames` deny-list. No realtime, no cancellation, no window check.

import type { Candidate, Leg } from "./journey_client.ts";
import type { Preference, ResolvedTunables } from "./preference.ts";

// One actionable journey rendered to the board.
export type Row = {
  kind: "row";
  // Sort key. The instant the user has to be out of the door.
  leaveByDate: Date;
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

  const leaveByDate = new Date(firstLeg.departure.getTime() - walkOutMs);
  const arriveByDate = new Date(lastLeg.arrival.getTime() + walkInMs);
  const durationMinutes = Math.round(
    (arriveByDate.getTime() - leaveByDate.getTime()) / 60_000,
  );

  return {
    kind: "row",
    leaveByDate,
    arriveByDate,
    durationMinutes,
    originLabel: activePreference.origin.displayName,
    destinationLabel: activePreference.destination.displayName,
    preferenceKey: activePreference.preferenceKey,
    preferenceLabel: activePreference.rowLabel,
    preferenceIcon: activePreference.rowIcon,
    legs: candidate.legs,
  };
}
