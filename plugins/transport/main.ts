import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import { type Board, boardValidForSeconds, createBoardAssembler } from "./bvg/board_assembler.ts";
import { ROUTES } from "@hztrmnl/config/plugins/transport/routes";
import DefaultTemplate, { type FrameData } from "./root.tsx";

// Re-exported for consumers (e.g. @hztrmnl/home) that import FrameData and
// Board by package name rather than by cross-member relative path.
export type { Board, FrameData };

// Dev-only "fake now" override. Set BVG_FAKE_NOW to an ISO timestamp (e.g.
// 2026-05-12T08:30:00+02:00) to pin the background refresh to that instant —
// useful for previewing the layout at different times of day without waiting.
// BVG's /journeys is still live, so the simulated time must be within the
// feed's real horizon (~ next 7 days) to return useful candidates. The
// dashboard scrubber (?t=) overrides this for scrub runs by going through the
// scrub branch in `run`, which anchors the fetch at the scrub's `ctx.t`.
function resolveBackgroundNow(): Date {
  const raw = Deno.env.get("BVG_FAKE_NOW");
  if (!raw) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(`[bvg] ignoring invalid BVG_FAKE_NOW=${raw}`);
    return new Date();
  }
  return parsed;
}

// `ctx.t` is `Temporal.ZonedDateTime`; the board pipeline (board_assembler,
// classifier, validity calc) is Date-based. Convert at the seam.
function tToDate(t: Temporal.ZonedDateTime): Date {
  return new Date(t.toInstant().epochMilliseconds);
}

const BACKGROUND_REFRESH_MS = 30_000;

// ADR-0002 module shape: default-export a Plugin object directly. This Plugin
// needs closure state (the assembler with its caches, the timer-refreshed
// board), so we build the object inline at the export site instead of in a
// top-level factory function. Importing this module starts the background
// refresh timer; that is intentional — the timer's lifecycle is bound to
// the Plugin's lifecycle.
const transport: Plugin<FrameData> = (() => {
  // ─── World-knowledge layer ────────────────────────────────────────────
  // One assembler instance, kept in the export-site closure so its internal
  // caches (lastSuccessfulFetchAt, observed travel times) survive across
  // runs. See bvg/board_assembler.ts for what those caches do.
  const assembler = createBoardAssembler();

  // Latest assembled board, refreshed on a wall-clock timer (NOT inside
  // `run`). Poll and prerender paths read this; scrub does a one-off fresh
  // fetch anchored at `ctx.t` so dashboard scrubbing actually time-travels
  // the board, not just the static chrome.
  let board: Board | null = null;
  const refreshBackground = async () => {
    try {
      board = await assembler.assembleBoard(ROUTES, resolveBackgroundNow());
    } catch (err) {
      console.warn("[bvg] background refresh failed:", err);
    }
  };
  refreshBackground();
  setInterval(refreshBackground, BACKGROUND_REFRESH_MS);

  // ─── Render layer ─────────────────────────────────────────────────────
  return {
    async run(ctx: RunContext): Promise<Result<FrameData>> {
      const here = ctx.intent === "scrub"
        // Scrub: time-travel by fetching BVG at the chosen t. The dashboard
        // scrubber is the only consumer with intent=scrub. Runs on a
        // throwaway assembler — a fetch anchored at a scrubbed instant must
        // not pollute the production assembler's keep-last-good caches with
        // candidates from some other window.
        ? await createBoardAssembler().assembleBoard(ROUTES, tToDate(ctx.t))
        // Poll / prerender: serve the timer-refreshed board. If the timer
        // hasn't fired yet (very first poll), block on a synchronous fetch
        // — any failure propagates to the Conductor's error-view fallback.
        : board ??
          (board = await assembler.assembleBoard(
            ROUTES,
            resolveBackgroundNow(),
          ));

      const validSeconds = Math.max(
        1,
        boardValidForSeconds(here, tToDate(ctx.t)),
      );
      return {
        state: { board: here },
        validity: Temporal.Duration.from({ seconds: validSeconds }),
        view: DefaultTemplate,
      };
    },
  } satisfies Plugin<FrameData>;
})();
export default transport;
