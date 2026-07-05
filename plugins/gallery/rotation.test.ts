import { assertEquals, assertNotEquals } from "@std/assert";
import { pickPhoto, ROTATION_INTERVAL, rotationValidity, VALIDITY_CAP } from "./rotation.ts";
import type { AlbumPhoto } from "./album.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INTERVAL_MS = ROTATION_INTERVAL.total({ unit: "milliseconds" });
const CAP_MS = VALIDITY_CAP.total({ unit: "milliseconds" });

// A fixed instant to anchor test fixtures on, expressed via Temporal duration
// arithmetic rather than raw epoch numbers so intent stays readable.
const ANCHOR = Temporal.Instant.from("2026-01-01T00:00:00Z");

function at(offset: Temporal.DurationLike): Temporal.ZonedDateTime {
  return ANCHOR.add(offset).toZonedDateTimeISO("UTC");
}

function photo(
  guid: string,
  batchDateCreated: string,
  dateCreated: string = batchDateCreated,
): AlbumPhoto {
  return {
    guid,
    dateCreated,
    batchDateCreated,
    width: 1536,
    height: 1024,
    checksum: `chk-${guid}`,
  };
}

// ---------------------------------------------------------------------------
// pickPhoto
// ---------------------------------------------------------------------------

Deno.test("pickPhoto: empty list → null", () => {
  assertEquals(pickPhoto([], at({ hours: 0 })), null);
});

Deno.test("pickPhoto: steady rotation walks newest→oldest hourly, then wraps", () => {
  // Already sorted newest-first, as fetchAlbum returns it.
  const photos = [
    photo("P0", "2026-01-01T00:00:00Z"),
    photo("P1", "2025-12-31T00:00:00Z"),
    photo("P2", "2025-12-30T00:00:00Z"),
  ];
  assertEquals(pickPhoto(photos, at({ hours: 0 })), photos[0]);
  assertEquals(pickPhoto(photos, at({ hours: 1 })), photos[1]);
  assertEquals(pickPhoto(photos, at({ hours: 2 })), photos[2]);
  // Wraps back to the newest after n=3 hours.
  assertEquals(pickPhoto(photos, at({ hours: 3 })), photos[0]);
  assertEquals(pickPhoto(photos, at({ hours: 4 })), photos[1]);
});

Deno.test("pickPhoto: mid-slot t stays on the same photo as the slot start", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  assertEquals(pickPhoto(photos, at({ minutes: 30 })), photos[0]);
  assertEquals(pickPhoto(photos, at({ hours: 1, minutes: 30 })), photos[1]);
});

Deno.test("pickPhoto: adding a newer photo re-anchors the position to 0", () => {
  // Before the add: two photos, mid-rotation on the older anchor.
  const before = [photo("OLD0", "2025-12-31T00:00:00Z"), photo("OLD1", "2025-12-30T00:00:00Z")];
  const midRotation = at({ hours: 5, minutes: 30 });
  assertNotEquals(pickPhoto(before, midRotation), null);

  // After sharing a new photo: it becomes index 0 with a newer
  // batchDateCreated, which becomes the new anchor. At that exact instant the
  // new photo shows immediately, regardless of where the old rotation was.
  const newAnchorIso = "2026-01-01T05:30:00Z"; // == midRotation
  const after = [photo("NEW", newAnchorIso), ...before];
  assertEquals(pickPhoto(after, midRotation), after[0]);
});

Deno.test("pickPhoto: a batch of N new photos walks all N newest→oldest before touching the rest", () => {
  // Three photos shared in the same batch (identical batchDateCreated),
  // tiebroken by capture time (dateCreated) descending, ahead of one older
  // photo from a previous batch.
  const photos = [
    photo("B0", "2026-01-01T00:00:00Z", "2025-06-03T00:00:00Z"),
    photo("B1", "2026-01-01T00:00:00Z", "2025-06-02T00:00:00Z"),
    photo("B2", "2026-01-01T00:00:00Z", "2025-06-01T00:00:00Z"),
    photo("OLD", "2025-01-01T00:00:00Z"),
  ];
  assertEquals(pickPhoto(photos, at({ hours: 0 })), photos[0]);
  assertEquals(pickPhoto(photos, at({ hours: 1 })), photos[1]);
  assertEquals(pickPhoto(photos, at({ hours: 2 })), photos[2]);
  assertEquals(pickPhoto(photos, at({ hours: 3 })), photos[3]);
});

Deno.test("pickPhoto: t before the anchor still resolves via Euclidean modulo", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  // slot = floor(-20min / 60min) = -1 → euclidMod(-1, 2) = 1.
  assertEquals(pickPhoto(photos, at({ minutes: -20 })), photos[1]);
});

Deno.test("pickPhoto: pre-1970 t still resolves to a real list member", () => {
  const photos = [
    photo("P0", "2026-01-01T00:00:00Z"),
    photo("P1", "2025-12-31T00:00:00Z"),
    photo("P2", "2025-12-30T00:00:00Z"),
  ];
  const preEpoch = Temporal.Instant.from("1969-01-01T00:00:00Z").toZonedDateTimeISO("UTC");
  const picked = pickPhoto(photos, preEpoch);
  assertNotEquals(picked, null);
  assertEquals(photos.includes(picked!), true);
});

// ---------------------------------------------------------------------------
// rotationValidity
// ---------------------------------------------------------------------------

Deno.test("rotationValidity: empty album → the validity cap", () => {
  assertEquals(rotationValidity([], at({ hours: 0 })).total({ unit: "milliseconds" }), CAP_MS);
});

Deno.test("rotationValidity: at a slot boundary, the full remainder exceeds the cap → capped", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  // Remainder to next boundary is the full interval (1h) > 15min cap.
  assertEquals(rotationValidity(photos, at({ hours: 0 })).total({ unit: "milliseconds" }), CAP_MS);
  assertNotEquals(INTERVAL_MS, CAP_MS); // sanity: the cap really is tighter than the interval
});

Deno.test("rotationValidity: remainder under the cap wins uncapped", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  // At +50min, next boundary is at +60min → 10min remainder, under the 15min cap.
  const validity = rotationValidity(photos, at({ minutes: 50 }));
  assertEquals(validity.total({ unit: "minutes" }), 10);
});

Deno.test("rotationValidity: t before the anchor is still positive and capped", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  // slot=-1 → next boundary is the anchor itself, 20min away, capped to 15min.
  const validity = rotationValidity(photos, at({ minutes: -20 }));
  assertEquals(validity.total({ unit: "milliseconds" }), CAP_MS);
});

Deno.test("rotationValidity: pre-1970 t is always in (0, cap]", () => {
  const photos = [photo("P0", "2026-01-01T00:00:00Z"), photo("P1", "2025-12-31T00:00:00Z")];
  const preEpoch = Temporal.Instant.from("1969-01-01T00:00:00Z").toZonedDateTimeISO("UTC");
  const ms = rotationValidity(photos, preEpoch).total({ unit: "milliseconds" });
  if (ms <= 0 || ms > CAP_MS) {
    throw new Error(`expected validity in (0, ${CAP_MS}], got ${ms}`);
  }
});
