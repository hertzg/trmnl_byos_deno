// Pure routing and validity logic for the Super-Plugin.
//
// This module is the gate-testable core: it contains all the routing and
// validity math but imports only types, so unit tests can exercise it without
// pulling in the real Transport plugin (which starts a BVG background refresh
// timer on import).

import type { Result } from "@hztrmnl/server/plugin";
import type { FrameData } from "@hztrmnl/transport";
import type { GalleryState } from "@hztrmnl/gallery";
import { activeWindowEnd, nextWindowStart } from "./sleep-window.ts";
import type { SleepWindow } from "./sleep-window.ts";

// Battery policy floor. The Device is never told to poll sooner than 5 minutes,
// accepting that fast-moving content (the realtime Transport board) may run up
// to 5 minutes stale. This floor lives here, in user code (the Super-Plugin),
// not in the Conductor — deliberately, so the policy is visible and adjustable
// without touching server internals.
export const VALIDITY_FLOOR: Temporal.Duration = Temporal.Duration.from({
  minutes: 5,
});

/**
 * Return whichever of `a` or `b` is the shorter duration.
 *
 * Uses `Temporal.Duration.compare` directly — valid because these durations
 * carry only minutes/seconds/milliseconds, which are calendar-unit-free.
 * No `relativeTo` is needed.
 */
export function minDuration(
  a: Temporal.Duration,
  b: Temporal.Duration,
): Temporal.Duration {
  return Temporal.Duration.compare(a, b) <= 0 ? a : b;
}

/**
 * Apply the 5-minute battery-policy floor.
 * Returns `d` if it is at or above the floor; otherwise returns `VALIDITY_FLOOR`.
 */
export function floorValidity(d: Temporal.Duration): Temporal.Duration {
  return Temporal.Duration.compare(d, VALIDITY_FLOOR) >= 0 ? d : VALIDITY_FLOOR;
}

/**
 * Route between Transport and Gallery results.
 *
 * Routing rule (from CONTEXT.md / Transport vocabulary):
 *   - `emptyReason === "noScheduleApplicable"` → Gallery branch.
 *     Transport is schedule-quiet; the Device should show photos, clamping
 *     validity to min(gallery, transport) so an opening commute window is woken
 *     into.
 *   - `emptyReason === "none"` or `"feedUnreachable"` → Transport branch.
 *     "none" means rows are present — show them. "feedUnreachable" means a live
 *     feed failed mid-commute — keep the board visible rather than routing to
 *     Gallery, so the user doesn't lose departure context during a real commute.
 *
 * In both branches, validity is floored at 5 minutes (battery policy — see
 * VALIDITY_FLOOR).
 *
 * `runGallery` is a thunk so Gallery's `run` is only called when the route
 * actually selects the Gallery branch. That avoids a redundant `run` call (and
 * any side effects it might have) on the Transport branch.
 *
 * Return type is `Result<FrameData | GalleryState>` — the union of both leaves.
 * We widen each branch's typed Result to the union *before* spreading it, so
 * `view`'s parameter type in the spread aligns with the union target. Spreading
 * an un-widened `Result<Specific>` directly into a union-typed return turns
 * `view` into a contravariant property under `strictFunctionTypes` and the
 * assignment fails. Method-syntax bivariance in the Result type definition
 * (see plugin.ts) is what makes the widen assignment safe.
 */
export async function composeResult(
  transportResult: Result<FrameData>,
  runGallery: () => Result<GalleryState> | Promise<Result<GalleryState>>,
): Promise<Result<FrameData | GalleryState>> {
  if (transportResult.state.board.emptyReason === "noScheduleApplicable") {
    // Gallery branch: Transport is schedule-quiet.
    const galleryResult = await runGallery();

    // Clamp validity: min(gallery, transport), then floor at 5 min.
    // The min keeps the Device's poll aligned with whichever window closes first
    // — typically the approaching commute window reported in transportResult.
    const clamped = minDuration(
      galleryResult.validity,
      transportResult.validity,
    );
    const validity = floorValidity(clamped);

    // Widen to the union first, then spread + override validity.
    // See the JSDoc above for why widening comes before the spread.
    // `hints` (including any `identity` assertion) rides through the spread
    // unchanged, transferring repaint-identity ownership to this Result —
    // fine here since Gallery's view passes through unwrapped.
    const widened: Result<FrameData | GalleryState> = galleryResult;
    return { ...widened, validity };
  }

  // Transport branch: emptyReason is "none" (rows present) or "feedUnreachable"
  // (dead feed mid-commute). In both cases the Transport result stays visible.
  const validity = floorValidity(transportResult.validity);

  // Widen to the union first, then spread + override validity.
  // `hints` rides through the spread unchanged, transferring
  // repaint-identity ownership to this Result — fine here since Transport's
  // view passes through unwrapped.
  const widened: Result<FrameData | GalleryState> = transportResult;
  return { ...widened, validity };
}

/**
 * Top-level compose function with sleep window integration.
 *
 * Routes between three branches:
 * - IN-WINDOW: skip Transport and Gallery entirely; return the Sleep leaf's
 *   Result with validity = remaining window duration (floor exempted).
 * - AWAKE: run Transport/Gallery routing (via composeResult), then clamp
 *   validity to the next window start (if configured), and apply floor.
 *
 * Parameters:
 * - `t`: current time in device's timezone (from RunContext)
 * - `windows`: parsed sleep windows (empty array = no sleep configured)
 * - `runTransport`, `runGallery`, `runSleep`: thunks (only invoked if needed)
 *
 * Return type unions all three leaves: FrameData | GalleryState | SleepState.
 * Widen before spreading to ensure `view` type alignment under strictFunctionTypes.
 */
export async function compose<SleepState>(
  t: Temporal.ZonedDateTime,
  windows: SleepWindow[],
  runTransport: () => Result<FrameData> | Promise<Result<FrameData>>,
  runGallery: () => Result<GalleryState> | Promise<Result<GalleryState>>,
  runSleep: () => Result<SleepState> | Promise<Result<SleepState>>,
): Promise<Result<FrameData | GalleryState | SleepState>> {
  // Check if we're currently in a sleep window.
  const windowEnd = activeWindowEnd(t, windows);

  if (windowEnd !== null) {
    // IN-WINDOW: show Sleep, skip Transport and Gallery.
    const sleepResult = await runSleep();

    // Compute validity = time until window ends, in zoned space (DST-safe).
    // No floor applies to this result.
    const validity = windowEnd.since(t);

    // Widen to union, then override validity.
    const widened: Result<FrameData | GalleryState | SleepState> = sleepResult;
    return { ...widened, validity };
  }

  // AWAKE: use composeResult for Transport/Gallery routing.
  let result = await composeResult(
    await runTransport(),
    runGallery,
  ) as Result<FrameData | GalleryState | SleepState>;

  // If windows are configured, clamp validity to the next window start.
  const nextStart = nextWindowStart(t, windows);
  if (nextStart !== null) {
    const timeToNextWindow = nextStart.since(t);
    // Clamp: min(current validity, time to next window).
    const clamped = minDuration(result.validity, timeToNextWindow);
    // Floor the clamped result (battery policy for awake).
    result = { ...result, validity: floorValidity(clamped) };
  }
  // else: no windows configured, result.validity is already floored by composeResult.

  return result;
}
