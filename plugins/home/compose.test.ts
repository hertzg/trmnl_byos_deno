import { assertEquals, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import type { Result, ResultHints } from "@hztrmnl/server/plugin";
import type { Board, FrameData } from "@hztrmnl/transport";
import type { GalleryState } from "@hztrmnl/gallery";
import { composeResult, floorValidity, minDuration, VALIDITY_FLOOR } from "./compose.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Temporal.Duration from minutes (the natural unit for validity tests). */
function mins(n: number): Temporal.Duration {
  return Temporal.Duration.from({ minutes: n });
}

/** A minimal Board cast. composeResult only reads `emptyReason`. */
function board(emptyReason: Board["emptyReason"]): Board {
  return { emptyReason } as Board;
}

/**
 * Fabricate a Result<FrameData> with an identity-testable view function.
 * Only `state.board.emptyReason`, `validity`, and `view` matter to composeResult.
 */
function makeTransportResult(
  emptyReason: Board["emptyReason"],
  validity: Temporal.Duration,
  hints?: Result<FrameData>["hints"],
): Result<FrameData> {
  const state: FrameData = {
    board: board(emptyReason),
  };
  return {
    state,
    validity,
    hints,
    view: (_s: FrameData) => null, // sentinel; identity tested via assertStrictEquals
  };
}

/**
 * Fabricate a Result<GalleryState> with an identity-testable view function.
 */
function makeGalleryResult(
  validity: Temporal.Duration,
  hints?: Result<GalleryState>["hints"],
): Result<GalleryState> {
  const state: GalleryState = { src: "/assets/gallery/test.jpg" };
  return {
    state,
    validity,
    hints,
    view: (_s: GalleryState) => null, // sentinel; identity tested via assertStrictEquals
  };
}

// ---------------------------------------------------------------------------
// Routing: emptyReason "none" → Transport branch
// ---------------------------------------------------------------------------

Deno.test('composeResult: emptyReason "none" → returns Transport result, runGallery not called', async () => {
  const transportResult = makeTransportResult("none", mins(10));
  const runGallery = spy(() => makeGalleryResult(mins(10)));

  const result = await composeResult(transportResult, runGallery);

  // State and view must be the Transport result's (identity check).
  assertStrictEquals(result.state, transportResult.state);
  assertStrictEquals(result.view, transportResult.view);

  // runGallery must not have been called.
  assertSpyCalls(runGallery, 0);
});

// ---------------------------------------------------------------------------
// Routing: emptyReason "feedUnreachable" → Transport branch (dead-feed rule)
// ---------------------------------------------------------------------------

Deno.test('composeResult: emptyReason "feedUnreachable" → returns Transport result, runGallery not called', async () => {
  // A dead feed mid-commute must NOT route to Gallery — the user needs to see
  // the board even if the live data is stale. Routing to Gallery here would
  // silently hide departure context during a real commute.
  const transportResult = makeTransportResult("feedUnreachable", mins(10));
  const runGallery = spy(() => makeGalleryResult(mins(10)));

  const result = await composeResult(transportResult, runGallery);

  assertStrictEquals(result.state, transportResult.state);
  assertStrictEquals(result.view, transportResult.view);
  assertSpyCalls(runGallery, 0);
});

// ---------------------------------------------------------------------------
// Routing: emptyReason "noScheduleApplicable" → Gallery branch
// ---------------------------------------------------------------------------

Deno.test('composeResult: emptyReason "noScheduleApplicable" → runs Gallery, returns Gallery result', async () => {
  const transportResult = makeTransportResult("noScheduleApplicable", mins(60));
  const galleryResult = makeGalleryResult(mins(30));
  const runGallery = spy(() => galleryResult);

  const result = await composeResult(transportResult, runGallery);

  // State and view must be the Gallery result's (identity check).
  assertStrictEquals(result.state, galleryResult.state);
  assertStrictEquals(result.view, galleryResult.view);

  // runGallery must have been called exactly once.
  assertSpyCalls(runGallery, 1);
});

// ---------------------------------------------------------------------------
// hints passthrough — Transport branch
// ---------------------------------------------------------------------------

Deno.test("composeResult: Transport branch — hints are passed through unchanged (reference identity)", async () => {
  const transportHints: ResultHints = { identity: "transport:x" };
  const transportResult = makeTransportResult("none", mins(10), transportHints);
  const runGallery = spy(() => makeGalleryResult(mins(10)));

  const result = await composeResult(transportResult, runGallery);

  // hints must be the exact same object reference — delegation, not reconstruction.
  assertStrictEquals(result.hints, transportHints);
  assertSpyCalls(runGallery, 0);
});

// ---------------------------------------------------------------------------
// hints passthrough — Gallery branch
// ---------------------------------------------------------------------------

Deno.test("composeResult: Gallery branch — hints are passed through unchanged (reference identity)", async () => {
  const galleryHints: ResultHints = { identity: "photo:x" };
  const transportResult = makeTransportResult("noScheduleApplicable", mins(60));
  const galleryResult = makeGalleryResult(mins(30), galleryHints);
  const runGallery = spy(() => galleryResult);

  const result = await composeResult(transportResult, runGallery);

  // hints must be the Gallery result's exact object reference — delegation, not reconstruction.
  assertStrictEquals(result.hints, galleryHints);
  assertSpyCalls(runGallery, 1);
});

// ---------------------------------------------------------------------------
// Validity floor — Transport branch
// ---------------------------------------------------------------------------

Deno.test("composeResult: Transport branch — validity below 5 min is floored to 5 min", async () => {
  // Transport reports 2-minute validity; output must be exactly 5 min.
  const transportResult = makeTransportResult("none", mins(2));
  const result = await composeResult(
    transportResult,
    () => makeGalleryResult(mins(1)),
  );

  assertEquals(result.validity.total({ unit: "minutes" }), 5);
});

Deno.test("composeResult: Transport branch — validity exactly 5 min is returned unchanged", async () => {
  const transportResult = makeTransportResult("none", mins(5));
  const result = await composeResult(
    transportResult,
    () => makeGalleryResult(mins(1)),
  );

  assertEquals(result.validity.total({ unit: "minutes" }), 5);
});

Deno.test("composeResult: Transport branch — validity above 5 min is returned unchanged", async () => {
  const transportResult = makeTransportResult("feedUnreachable", mins(20));
  const result = await composeResult(
    transportResult,
    () => makeGalleryResult(mins(1)),
  );

  assertEquals(result.validity.total({ unit: "minutes" }), 20);
});

// ---------------------------------------------------------------------------
// Validity clamp + floor — Gallery branch
// ---------------------------------------------------------------------------

Deno.test("composeResult: Gallery branch — gallery 3 min + transport 9 min → min is 3 min → floored to 5 min", async () => {
  // min(3, 9) = 3; floor(3) = 5.
  const transportResult = makeTransportResult("noScheduleApplicable", mins(9));
  const galleryResult = makeGalleryResult(mins(3));
  const result = await composeResult(transportResult, () => galleryResult);

  assertEquals(result.validity.total({ unit: "minutes" }), 5);
});

Deno.test("composeResult: Gallery branch — gallery 8 min + transport 20 min → min is 8 min → above floor, returned unchanged", async () => {
  // min(8, 20) = 8; floor(8) = 8.
  const transportResult = makeTransportResult("noScheduleApplicable", mins(20));
  const galleryResult = makeGalleryResult(mins(8));
  const result = await composeResult(transportResult, () => galleryResult);

  assertEquals(result.validity.total({ unit: "minutes" }), 8);
});

Deno.test("composeResult: Gallery branch — gallery 8 min + transport 6 min → transport wins min → 6 min", async () => {
  // min(8, 6) = 6; floor(6) = 6.
  const transportResult = makeTransportResult("noScheduleApplicable", mins(6));
  const galleryResult = makeGalleryResult(mins(8));
  const result = await composeResult(transportResult, () => galleryResult);

  assertEquals(result.validity.total({ unit: "minutes" }), 6);
});

Deno.test("composeResult: Gallery branch — gallery 2 min + transport 3 min → min is 2 min → floored to 5 min", async () => {
  // min(2, 3) = 2; floor(2) = 5.
  const transportResult = makeTransportResult("noScheduleApplicable", mins(3));
  const galleryResult = makeGalleryResult(mins(2));
  const result = await composeResult(transportResult, () => galleryResult);

  assertEquals(result.validity.total({ unit: "minutes" }), 5);
});

// ---------------------------------------------------------------------------
// Result.validity is a Temporal.Duration
// ---------------------------------------------------------------------------

Deno.test("composeResult: Transport branch — result.validity is a Temporal.Duration", async () => {
  const transportResult = makeTransportResult("none", mins(10));
  const result = await composeResult(
    transportResult,
    () => makeGalleryResult(mins(1)),
  );

  assertEquals(result.validity instanceof Temporal.Duration, true);
});

Deno.test("composeResult: Gallery branch — result.validity is a Temporal.Duration", async () => {
  const transportResult = makeTransportResult("noScheduleApplicable", mins(10));
  const result = await composeResult(
    transportResult,
    () => makeGalleryResult(mins(8)),
  );

  assertEquals(result.validity instanceof Temporal.Duration, true);
});

// ---------------------------------------------------------------------------
// runGallery async thunk — Gallery branch handles async thunks
// ---------------------------------------------------------------------------

Deno.test("composeResult: Gallery branch — async runGallery thunk is awaited correctly", async () => {
  const transportResult = makeTransportResult("noScheduleApplicable", mins(20));
  const galleryResult = makeGalleryResult(mins(10));
  // Return a Promise rather than a direct value.
  const runGallery = spy(() => Promise.resolve(galleryResult));

  const result = await composeResult(transportResult, runGallery);

  assertStrictEquals(result.state, galleryResult.state);
  assertStrictEquals(result.view, galleryResult.view);
  assertSpyCalls(runGallery, 1);
});

// ---------------------------------------------------------------------------
// Unit tests for exported helpers
// ---------------------------------------------------------------------------

Deno.test("VALIDITY_FLOOR is 5 minutes", () => {
  assertEquals(VALIDITY_FLOOR.total({ unit: "minutes" }), 5);
});

Deno.test("minDuration: returns the shorter duration", () => {
  assertEquals(minDuration(mins(3), mins(7)).total({ unit: "minutes" }), 3);
  assertEquals(minDuration(mins(7), mins(3)).total({ unit: "minutes" }), 3);
});

Deno.test("minDuration: equal durations — returns either (value equality)", () => {
  assertEquals(minDuration(mins(5), mins(5)).total({ unit: "minutes" }), 5);
});

Deno.test("floorValidity: below floor → returns VALIDITY_FLOOR", () => {
  assertEquals(floorValidity(mins(2)).total({ unit: "minutes" }), 5);
});

Deno.test("floorValidity: at floor → returns input value", () => {
  assertEquals(floorValidity(mins(5)).total({ unit: "minutes" }), 5);
});

Deno.test("floorValidity: above floor → returns input value", () => {
  assertEquals(floorValidity(mins(12)).total({ unit: "minutes" }), 12);
});
