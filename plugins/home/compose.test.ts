import { assertEquals, assertStrictEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import type { Result, ResultHints } from "@hztrmnl/server/plugin";
import type { Board, FrameData } from "@hztrmnl/transport";
import type { GalleryState } from "@hztrmnl/gallery";
import { compose, composeResult, floorValidity, minDuration, VALIDITY_FLOOR } from "./compose.ts";
import type { SleepWindow } from "./sleep-window.ts";

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

// ---------------------------------------------------------------------------
// Sleep window integration (new compose function)
// ---------------------------------------------------------------------------

/**
 * Build a Temporal.ZonedDateTime at wall-clock time HH:MM on 2026-07-15
 * in Europe/Berlin (DST active at this date).
 * Used for sleep window tests.
 */
function makeZonedTime(hh: number, mm: number): Temporal.ZonedDateTime {
  const date = Temporal.PlainDate.from("2026-07-15");
  const time = Temporal.PlainTime.from({ hour: hh, minute: mm });
  return date.toZonedDateTime({
    timeZone: "Europe/Berlin",
    plainTime: time,
  });
}

/**
 * Fabricate a Result<SleepState> for testing.
 */
interface SleepState {
  readonly [key: string]: never;
}
function makeSleepResult(
  validity: Temporal.Duration,
): Result<SleepState> {
  const state: SleepState = {};
  return {
    state,
    validity,
    view: (_s: SleepState) => null, // sentinel
  };
}

/**
 * Fabricate a Result<NoticeState> for testing.
 *
 * Only `state.notices.length` and `validity` matter to compose; the bubble
 * contents are opaque to it.
 */
interface NoticeState {
  notices: readonly { id: string }[];
  earlierCount: number;
}
function makeNoticeResult(
  validity: Temporal.Duration,
  notices: readonly { id: string }[],
): Result<NoticeState> {
  const state: NoticeState = { notices, earlierCount: 0 };
  return {
    state,
    validity,
    view: (_s: NoticeState) => null, // sentinel
  };
}

/**
 * The notice thunk for every test that is not about notices: an empty thread.
 * The leaf reports its nominal 1-hour validity when nothing is live, which
 * compose must ignore entirely.
 */
function noNotices(): Result<NoticeState> {
  return makeNoticeResult(Temporal.Duration.from({ hours: 1 }), []);
}

// ---------------------------------------------------------------------------
// IN-WINDOW: returns sleep result, no transport/gallery execution
// ---------------------------------------------------------------------------

Deno.test("compose: in-window → returns sleep result, transport spy NOT called", async () => {
  // t = 23:30, window = 23:00–07:00, so we're inside.
  const t = makeZonedTime(23, 30);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const transportResult = makeTransportResult("none", mins(20));
  const runTransport = spy(() => transportResult);
  const runGallery = spy(() => makeGalleryResult(mins(10)));
  const sleepResult = makeSleepResult(mins(60));
  const runSleep = spy(() => sleepResult);

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // State and view must be the sleep result's (identity check).
  assertStrictEquals(result.state, sleepResult.state);
  assertStrictEquals(result.view, sleepResult.view);

  // Transport and Gallery must NOT have been called.
  assertSpyCalls(runTransport, 0);
  assertSpyCalls(runGallery, 0);

  // Sleep must have been called exactly once.
  assertSpyCalls(runSleep, 1);
});

// ---------------------------------------------------------------------------
// IN-WINDOW: validity = exact remaining window (no floor)
// ---------------------------------------------------------------------------

Deno.test("compose: in-window at 23:30, window 23:00–07:00 → validity 7h30m", async () => {
  const t = makeZonedTime(23, 30);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const runTransport = () => makeTransportResult("none", mins(20));
  const runGallery = () => makeGalleryResult(mins(10));
  const runSleep = () => makeSleepResult(mins(60));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // Window ends at 07:00 next day. From 23:30 to 07:00 = 7 hours 30 minutes.
  assertEquals(result.validity.total({ unit: "minutes" }), 7.5 * 60);
});

// ---------------------------------------------------------------------------
// IN-WINDOW early-wake: validity below floor proves floor exemption
// ---------------------------------------------------------------------------

Deno.test("compose: in-window at 06:58, window 23:00–07:00 → validity 2 minutes (below floor, no exemption needed)", async () => {
  const t = makeZonedTime(6, 58);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const runTransport = () => makeTransportResult("none", mins(20));
  const runGallery = () => makeGalleryResult(mins(10));
  const runSleep = () => makeSleepResult(mins(60));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // Window ends at 07:00. From 06:58 to 07:00 = 2 minutes.
  // This is below VALIDITY_FLOOR (5 min), proving that in-window results
  // are exempt from the floor.
  assertEquals(result.validity.total({ unit: "minutes" }), 2);
});

// ---------------------------------------------------------------------------
// AWAKE: existing routing logic unchanged
// ---------------------------------------------------------------------------

Deno.test("compose: awake (no window match) → transport emptyReason 'none' returns Transport", async () => {
  // t = 10:00, no windows defined, so definitely awake.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [];

  const transportResult = makeTransportResult("none", mins(20));
  const runTransport = spy(() => transportResult);
  const runGallery = spy(() => makeGalleryResult(mins(10)));
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // State and view must be Transport's.
  assertStrictEquals(result.state, transportResult.state);
  assertStrictEquals(result.view, transportResult.view);

  // Transport must be called, Gallery must NOT.
  assertSpyCalls(runTransport, 1);
  assertSpyCalls(runGallery, 0);
  assertSpyCalls(runSleep, 0);
});

Deno.test("compose: awake (no window match) → transport emptyReason 'noScheduleApplicable' returns Gallery", async () => {
  // t = 12:00, no windows, transport quiet → gallery branch.
  const t = makeZonedTime(12, 0);
  const windows: SleepWindow[] = [];

  const transportResult = makeTransportResult("noScheduleApplicable", mins(60));
  const galleryResult = makeGalleryResult(mins(30));
  const runTransport = spy(() => transportResult);
  const runGallery = spy(() => galleryResult);
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // State and view must be Gallery's.
  assertStrictEquals(result.state, galleryResult.state);
  assertStrictEquals(result.view, galleryResult.view);

  // Transport must be called, Gallery must be called, Sleep must NOT.
  assertSpyCalls(runTransport, 1);
  assertSpyCalls(runGallery, 1);
  assertSpyCalls(runSleep, 0);
});

// ---------------------------------------------------------------------------
// AWAKE: validity clamped to nextWindowStart, floor applied
// ---------------------------------------------------------------------------

Deno.test("compose: awake at 20:00, window 23:00–07:00 → gallery 30min, transport 90min → clamp to 3 hours (180 min to next window) → floored to 5 min? no, 180 > 5", async () => {
  // t = 20:00, next window starts at 23:00 = 3 hours away = 180 minutes.
  // gallery validity = 30 min, transport validity = 90 min.
  // min(30, 90, 180) = 30.
  // floor(30) = 30 (already above floor).
  const t = makeZonedTime(20, 0);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const transportResult = makeTransportResult("noScheduleApplicable", mins(90));
  const galleryResult = makeGalleryResult(mins(30));
  const runTransport = () => transportResult;
  const runGallery = () => galleryResult;
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // min(30, 90) = 30 (gallery+transport clamp, per composeResult),
  // then min(30, 180) = 30 (sleep window clamp),
  // floor(30) = 30.
  assertEquals(result.validity.total({ unit: "minutes" }), 30);
  assertSpyCalls(runSleep, 0);
});

Deno.test("compose: awake at 22:00, window 23:00–07:00 → transport 90min, gallery 60min → clamp to 60min (window start) → floored to 5min? no, 60 > 5", async () => {
  // t = 22:00, next window starts at 23:00 = 60 minutes away.
  // transport validity = 90 min, gallery quiet.
  // Compose returns min(60 Transport) = 60.
  // Then clamp to min(60, 60) = 60 (window start is sooner than leaf).
  // floor(60) = 60.
  const t = makeZonedTime(22, 0);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const transportResult = makeTransportResult("none", mins(90));
  const runTransport = () => transportResult;
  const runGallery = spy(() => makeGalleryResult(mins(10)));
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // Transport 90 min, floor(90) = 90.
  // Then clamp to min(90, 60) = 60, floor(60) = 60.
  assertEquals(result.validity.total({ unit: "minutes" }), 60);
  assertSpyCalls(runGallery, 0);
  assertSpyCalls(runSleep, 0);
});

Deno.test("compose: awake validity below floor → clamped to floor, sleep does not override", async () => {
  // t = 10:00, next window 23:00 = 13 hours away.
  // transport validity = 2 min (below floor).
  // floor(2) = 5, then min(5, 780 to window) = 5.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const transportResult = makeTransportResult("none", mins(2));
  const runTransport = () => transportResult;
  const runGallery = spy(() => makeGalleryResult(mins(1)));
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // Transport 2 min, floor(2) = 5.
  // min(5, 780) = 5.
  assertEquals(result.validity.total({ unit: "minutes" }), 5);
  assertSpyCalls(runSleep, 0);
});

// ---------------------------------------------------------------------------
// AWAKE: no windows configured → behavior identical to before
// ---------------------------------------------------------------------------

Deno.test("compose: awake with no windows → behaves exactly like old composeResult", async () => {
  // t = 14:00, no windows, transport "noScheduleApplicable" → gallery.
  const t = makeZonedTime(14, 0);
  const windows: SleepWindow[] = [];

  const transportResult = makeTransportResult("noScheduleApplicable", mins(60));
  const galleryResult = makeGalleryResult(mins(3)); // Below floor, so floored to 5.
  const runTransport = () => transportResult;
  const runGallery = () => galleryResult;
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, noNotices);

  // min(3, 60) = 3, floor(3) = 5.
  // No window clamp (windows empty).
  assertEquals(result.validity.total({ unit: "minutes" }), 5);
  assertStrictEquals(result.state, galleryResult.state);
  assertSpyCalls(runSleep, 0);
});

// ---------------------------------------------------------------------------
// NOTICE: a live notice beats everything, including an active sleep window
// ---------------------------------------------------------------------------

Deno.test("compose: live notice during a sleep window → returns the notice result, sleep spy NOT called", async () => {
  // t = 23:30, window = 23:00–07:00, so we are inside the window and would
  // normally get the Sleep screen. A live notice outranks it.
  const t = makeZonedTime(23, 30);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const noticeResult = makeNoticeResult(mins(15), [{ id: "notice-abc123" }]);
  const runNotice = spy(() => noticeResult);
  const runTransport = spy(() => makeTransportResult("none", mins(20)));
  const runGallery = spy(() => makeGalleryResult(mins(10)));
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, runNotice);

  // State and view must be the notice result's (identity check).
  assertStrictEquals(result.state, noticeResult.state);
  assertStrictEquals(result.view, noticeResult.view);

  // No other leaf runs.
  assertSpyCalls(runNotice, 1);
  assertSpyCalls(runSleep, 0);
  assertSpyCalls(runTransport, 0);
  assertSpyCalls(runGallery, 0);
});

Deno.test("compose: live notice while Transport has rows → returns the notice result, transport spy NOT called", async () => {
  // t = 10:00, no windows, so definitely awake. Transport reports rows
  // ("none"), which would normally win the board. A live notice outranks it.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [];

  const noticeResult = makeNoticeResult(mins(15), [{ id: "notice-def456" }]);
  const runNotice = spy(() => noticeResult);
  const runTransport = spy(() => makeTransportResult("none", mins(20)));
  const runGallery = spy(() => makeGalleryResult(mins(10)));
  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(t, windows, runTransport, runGallery, runSleep, runNotice);

  assertStrictEquals(result.state, noticeResult.state);
  assertSpyCalls(runTransport, 0);
  assertSpyCalls(runGallery, 0);
  assertSpyCalls(runSleep, 0);
});

Deno.test("compose: notice branch returns the leaf's Result object untouched", async () => {
  // The Notice leaf owns its own validity — the earliest expiry among the live
  // notices — so this branch delegates rather than reconstructs. Reference
  // identity on the whole Result covers state, validity, hints and view at once.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [];

  const noticeResult = makeNoticeResult(mins(15), [{ id: "notice-ghi789" }]);

  const result = await compose(
    t,
    windows,
    () => makeTransportResult("none", mins(20)),
    () => makeGalleryResult(mins(10)),
    () => makeSleepResult(mins(60)),
    () => noticeResult,
  );

  assertStrictEquals(result, noticeResult);
});

Deno.test("compose: notice validity of 2 minutes is not raised to the 5-minute floor", async () => {
  // The notice branch is exempt from VALIDITY_FLOOR, the same exemption the
  // Sleep branch has, so a notice leaves the screen on the minute rather than
  // up to five minutes late.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [];

  const result = await compose(
    t,
    windows,
    () => makeTransportResult("none", mins(20)),
    () => makeGalleryResult(mins(10)),
    () => makeSleepResult(mins(60)),
    () => makeNoticeResult(mins(2), [{ id: "notice-jkl012" }]),
  );

  assertEquals(result.validity.total({ unit: "minutes" }), 2);
});

Deno.test("compose: notice sent during the window, expiring after the wake — still shown at 07:01, not clamped to the next window start", async () => {
  // Sent at 23:30 inside the 23:00–07:00 window; #141 measured its 15 minutes
  // from the 07:00 wake-up, so it expires at 07:15. At 07:01 the panel is awake
  // and the notice has 14 minutes left. That 14 minutes must survive: no clamp
  // to the 23:00 next window start (13h59m away), no floor.
  const t = makeZonedTime(7, 1);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const runSleep = spy(() => makeSleepResult(mins(60)));

  const result = await compose(
    t,
    windows,
    () => makeTransportResult("none", mins(20)),
    () => makeGalleryResult(mins(10)),
    runSleep,
    () => makeNoticeResult(mins(14), [{ id: "notice-mno345" }]),
  );

  assertEquals(result.validity.total({ unit: "minutes" }), 14);
  assertSpyCalls(runSleep, 0);
});

Deno.test("compose: empty thread inside a sleep window → falls through to the Sleep result", async () => {
  // An empty thread must leave existing routing unchanged: the notice thunk is
  // consulted, finds nothing live, and the sleep check runs as before.
  const t = makeZonedTime(23, 30);
  const windows: SleepWindow[] = [
    { from: Temporal.PlainTime.from("23:00"), until: Temporal.PlainTime.from("07:00") },
  ];

  const sleepResult = makeSleepResult(mins(60));
  const runNotice = spy(noNotices);

  const result = await compose(
    t,
    windows,
    () => makeTransportResult("none", mins(20)),
    () => makeGalleryResult(mins(10)),
    () => sleepResult,
    runNotice,
  );

  assertStrictEquals(result.state, sleepResult.state);
  assertSpyCalls(runNotice, 1);
});

Deno.test("compose: empty thread while awake → falls through to Transport, notice validity ignored", async () => {
  // The empty-thread leaf reports a nominal 1-hour validity. It must not leak
  // into the awake branch's math: transport's 20 minutes is the answer.
  const t = makeZonedTime(10, 0);
  const windows: SleepWindow[] = [];

  const transportResult = makeTransportResult("none", mins(20));

  const result = await compose(
    t,
    windows,
    () => transportResult,
    () => makeGalleryResult(mins(10)),
    () => makeSleepResult(mins(60)),
    noNotices,
  );

  assertStrictEquals(result.state, transportResult.state);
  assertEquals(result.validity.total({ unit: "minutes" }), 20);
});
