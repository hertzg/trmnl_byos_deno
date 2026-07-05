// Anchored recency rotation — pure functions over AlbumPhoto[], no I/O, no DOM.
//
// `photos` is expected sorted newest-first, as `fetchAlbum` returns it: index
// 0 is the most recently added photo, so its `batchDateCreated` anchors the
// rotation lattice. Anchoring on the newest addition — rather than a fixed
// epoch — means adding photos always re-derives the position to 0: a batch of
// N new photos walks newest→oldest over the next N hours, and an unchanged
// album degenerates to steady hourly rotation from wherever the lattice
// already was. Both functions are pure in the photo list and `t`, so a
// dashboard scrub at some `t` reproduces exactly what the Device would have
// seen at that instant — no stored rotation position.

import type { AlbumPhoto } from "./album.ts";

// How long each photo stays up before the next slot takes over.
export const ROTATION_INTERVAL: Temporal.Duration = Temporal.Duration.from({ hours: 1 });
const intervalMs = ROTATION_INTERVAL.total({ unit: "milliseconds" });

// Ceiling on the validity this module ever returns: the retry validity on an
// empty album, and the cap on the remaining-time-to-boundary otherwise. This
// is the change-detection cadence — the Device only learns about an album
// edit (new/removed photos) by polling again, so it bounds how fast an edit
// on the phone reaches the glass.
export const VALIDITY_CAP: Temporal.Duration = Temporal.Duration.from({ minutes: 15 });
const capMs = VALIDITY_CAP.total({ unit: "milliseconds" });

// JS `%` is sign-preserving, so a negative dividend yields a negative
// remainder and an out-of-bounds index. This Euclidean form keeps the result
// in [0, n) for any `a`, including `t` values before the anchor or pre-1970.
function euclidMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function anchorMs(photos: readonly AlbumPhoto[]): number {
  return Temporal.Instant.from(photos[0].batchDateCreated).epochMilliseconds;
}

/**
 * The photo current at `t`, or `null` for an empty album.
 */
export function pickPhoto(
  photos: readonly AlbumPhoto[],
  t: Temporal.ZonedDateTime,
): AlbumPhoto | null {
  const n = photos.length;
  if (n === 0) return null;
  const anchor = anchorMs(photos);
  const slot = Math.floor((t.epochMilliseconds - anchor) / intervalMs);
  return photos[euclidMod(slot, n)];
}

/**
 * How long the current pick stays the correct answer: the remaining time to
 * the next anchored slot boundary, capped at `VALIDITY_CAP` (also the value
 * returned for an empty album).
 */
export function rotationValidity(
  photos: readonly AlbumPhoto[],
  t: Temporal.ZonedDateTime,
): Temporal.Duration {
  if (photos.length === 0) return VALIDITY_CAP;
  const anchor = anchorMs(photos);
  const slot = Math.floor((t.epochMilliseconds - anchor) / intervalMs);
  const nextBoundaryMs = anchor + (slot + 1) * intervalMs;
  const remainderMs = nextBoundaryMs - t.epochMilliseconds;
  return Temporal.Duration.from({ milliseconds: Math.min(remainderMs, capMs) });
}
