// Sequential, time-indexed photo rotation — pure functions, no DOM, no I/O.

// How long each photo stays on screen before the next one takes over.
export const ROTATION_INTERVAL: Temporal.Duration = Temporal.Duration.from({
  hours: 6,
});

const intervalMs: number = ROTATION_INTERVAL.total({ unit: "milliseconds" });

/**
 * Return the photo URL that is current at `t`, or `null` when there are no
 * photos.  Selection is sequential and time-indexed so the output is a pure
 * function of the photo list and `t` — the same inputs always produce the same
 * photo, whether called from a Device poll or a dashboard scrub.
 */
export function pickPhoto(
  photos: readonly string[],
  t: Temporal.ZonedDateTime,
): string | null {
  if (photos.length === 0) return null;
  const n = photos.length;
  // JS `%` is sign-preserving, so a negative epoch yields a negative remainder
  // and an out-of-bounds index.  The `((x % n) + n) % n` form is a Euclidean
  // modulo that keeps the index in [0, n) for any `t`, including pre-1970.
  const index = ((Math.floor(t.epochMilliseconds / intervalMs) % n) + n) % n;
  return photos[index];
}

/**
 * How long the current photo is still the correct answer — the milliseconds
 * remaining until the next rotation boundary.  Carries as `Result.validity` so
 * the Slot stays warm until the swap instant and no sooner.
 *
 * Uses the next-boundary form so the result is always in (0, intervalMs] for
 * any `t`, including pre-epoch (negative epochMilliseconds) values reachable
 * via a dashboard scrub.
 */
export function rotationValidity(t: Temporal.ZonedDateTime): Temporal.Duration {
  const slot = Math.floor(t.epochMilliseconds / intervalMs);
  const nextBoundaryMs = (slot + 1) * intervalMs;
  const msUntilNext = nextBoundaryMs - t.epochMilliseconds;
  return Temporal.Duration.from({ milliseconds: msUntilNext });
}
