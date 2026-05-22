import { assertEquals } from "@std/assert";
import { pickPhoto, ROTATION_INTERVAL, rotationValidity } from "./rotation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ROTATION_INTERVAL in milliseconds — kept local so tests don't import the
// private `intervalMs` from the module under test.
const INTERVAL_MS = ROTATION_INTERVAL.total({ unit: "milliseconds" });

/** Build a ZonedDateTime from an epoch-millisecond offset. */
function zdt(epochMs: number): Temporal.ZonedDateTime {
  return new Temporal.Instant(BigInt(epochMs) * 1_000_000n).toZonedDateTimeISO(
    "UTC",
  );
}

// Fake URL strings — no real files needed.
const PHOTOS = [
  "/assets/gallery/a.jpg",
  "/assets/gallery/b.jpg",
  "/assets/gallery/c.jpg",
];

// ---------------------------------------------------------------------------
// pickPhoto
// ---------------------------------------------------------------------------

Deno.test("pickPhoto: empty array → null", () => {
  const t = zdt(0);
  assertEquals(pickPhoto([], t), null);
});

Deno.test("pickPhoto: single photo is always returned regardless of t", () => {
  const single = ["/assets/gallery/only.jpg"];
  assertEquals(pickPhoto(single, zdt(0)), "/assets/gallery/only.jpg");
  assertEquals(
    pickPhoto(single, zdt(INTERVAL_MS * 99)),
    "/assets/gallery/only.jpg",
  );
});

Deno.test("pickPhoto: at t=0 selects the first photo", () => {
  assertEquals(pickPhoto(PHOTOS, zdt(0)), PHOTOS[0]);
});

Deno.test("pickPhoto: advances to the next photo exactly at the interval boundary", () => {
  // At exactly 1 interval, index = 1 % 3 = 1 → PHOTOS[1].
  assertEquals(pickPhoto(PHOTOS, zdt(INTERVAL_MS)), PHOTOS[1]);
  // At exactly 2 intervals, index = 2 % 3 = 2 → PHOTOS[2].
  assertEquals(pickPhoto(PHOTOS, zdt(2 * INTERVAL_MS)), PHOTOS[2]);
});

Deno.test("pickPhoto: one millisecond before the boundary stays on the current photo", () => {
  // At (INTERVAL_MS - 1) we are still in slot 0 → PHOTOS[0].
  assertEquals(pickPhoto(PHOTOS, zdt(INTERVAL_MS - 1)), PHOTOS[0]);
  // At (2 * INTERVAL_MS - 1) we are in slot 1 → PHOTOS[1].
  assertEquals(pickPhoto(PHOTOS, zdt(2 * INTERVAL_MS - 1)), PHOTOS[1]);
});

Deno.test("pickPhoto: modulo wraps back to the start after all photos shown", () => {
  // After 3 intervals (n = PHOTOS.length), index = 3 % 3 = 0 → back to PHOTOS[0].
  assertEquals(pickPhoto(PHOTOS, zdt(3 * INTERVAL_MS)), PHOTOS[0]);
  // After 4 intervals → PHOTOS[1].
  assertEquals(pickPhoto(PHOTOS, zdt(4 * INTERVAL_MS)), PHOTOS[1]);
  // Large multiple — verify modulo continues to wrap correctly.
  assertEquals(
    pickPhoto(PHOTOS, zdt(100 * INTERVAL_MS)),
    PHOTOS[100 % PHOTOS.length],
  );
});

Deno.test("pickPhoto: mid-interval t stays on the same photo as the boundary start", () => {
  const midInterval = Math.floor(INTERVAL_MS / 2);
  assertEquals(pickPhoto(PHOTOS, zdt(midInterval)), PHOTOS[0]);
  assertEquals(pickPhoto(PHOTOS, zdt(INTERVAL_MS + midInterval)), PHOTOS[1]);
});

// ---------------------------------------------------------------------------
// rotationValidity
// ---------------------------------------------------------------------------

Deno.test("rotationValidity: at an exact boundary returns the full interval", () => {
  // At t = INTERVAL_MS (the start of slot 1), the next boundary is exactly
  // one full interval away.
  const validity = rotationValidity(zdt(INTERVAL_MS));
  assertEquals(validity.total({ unit: "milliseconds" }), INTERVAL_MS);
});

Deno.test("rotationValidity: at t=0 (exact boundary) returns the full interval", () => {
  const validity = rotationValidity(zdt(0));
  assertEquals(validity.total({ unit: "milliseconds" }), INTERVAL_MS);
});

Deno.test("rotationValidity: mid-interval returns the remaining half", () => {
  const midInterval = Math.floor(INTERVAL_MS / 2);
  const validity = rotationValidity(zdt(midInterval));
  // Remaining = INTERVAL_MS - midInterval.
  assertEquals(
    validity.total({ unit: "milliseconds" }),
    INTERVAL_MS - midInterval,
  );
});

Deno.test("rotationValidity: one millisecond before a boundary returns 1 ms", () => {
  const validity = rotationValidity(zdt(2 * INTERVAL_MS - 1));
  assertEquals(validity.total({ unit: "milliseconds" }), 1);
});

Deno.test("rotationValidity: result is a Temporal.Duration (not a number)", () => {
  const validity = rotationValidity(zdt(42));
  // Verify the returned value is actually a Temporal.Duration.
  assertEquals(validity instanceof Temporal.Duration, true);
});

Deno.test("rotationValidity: validity is always positive (> 0)", () => {
  for (const epochMs of [0, 1, INTERVAL_MS - 1, INTERVAL_MS, 2 * INTERVAL_MS]) {
    const ms = rotationValidity(zdt(epochMs)).total({ unit: "milliseconds" });
    if (ms <= 0) {
      throw new Error(
        `Expected positive validity at epochMs=${epochMs}, got ${ms}`,
      );
    }
  }
});
