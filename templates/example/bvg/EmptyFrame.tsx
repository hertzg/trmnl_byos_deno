/** @jsxImportSource hono/jsx */

// EmptyFrame — the v3 wireframe's empty-state block.
//
// Branches on `Board.emptyReason`:
//   - "none"                 → nothing rendered (parent renders rows)
//   - "noScheduleApplicable" → "nothing to show right now" + next-anchor hint
//   - "feedUnreachable"      → "feed unreachable" + "data is N m old · retrying"
//
// Age is computed at render time (rather than inside the assembler) so the
// number stays fresh against `now` — the assembler's `fetchedAt` and the
// caller's render `now` may differ.

import type { Board } from "./board_assembler.ts";
import { formatHHMM } from "./time.ts";

const BERLIN_TZ = "Europe/Berlin";

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  weekday: "short",
});

function formatBerlinWeekday(d: Date): string {
  return WEEKDAY_FMT.format(d);
}

// Whole minutes elapsed between `from` and `now`, floored at 0. Used for the
// "data is N m old" stamp on the feedUnreachable frame.
function ageInMinutes(from: Date | null | undefined, now: Date): number {
  if (!from) return 0;
  const ms = now.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 60_000);
}

export default function EmptyFrame({ board, now }: { board: Board; now: Date }) {
  if (board.emptyReason === "none") return null;

  if (board.emptyReason === "feedUnreachable") {
    const minutes = ageInMinutes(board.lastSuccessfulFetchAt, now);
    return (
      <div class="empty">
        <div class="empty__big">feed unreachable</div>
        <div class="empty__sub">data is {minutes} m old · retrying</div>
      </div>
    );
  }

  // noScheduleApplicable
  const anchor = board.nextAnchor;
  return (
    <div class="empty">
      <div class="empty__big">nothing to show right now</div>
      {anchor && (
        <div class="empty__sub">
          next: {formatBerlinWeekday(anchor.arriveByDate)} {formatHHMM(anchor.arriveByDate)} ·{" "}
          {anchor.preferenceIcon} · {anchor.preferenceLabel}
        </div>
      )}
    </div>
  );
}
