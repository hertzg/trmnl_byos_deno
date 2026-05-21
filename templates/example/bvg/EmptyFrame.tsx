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

import { EmptyState } from "../../ds/EmptyState.tsx";
import type { Board } from "./board_assembler.ts";
import { formatHHMM, formatKaWeekday } from "./time.ts";

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
      <EmptyState
        big="მონაცემები მიუწვდომელია"
        sub={`${minutes} წთ-ის წინანდელი · ვცდი თავიდან`}
      />
    );
  }

  // noScheduleApplicable
  const anchor = board.nextAnchor;
  return (
    <EmptyState
      big="ცარიელია"
      sub={anchor
        ? (
          <>
            შემდეგი: {formatKaWeekday(anchor.arriveByDate)} {formatHHMM(anchor.arriveByDate)} ·{" "}
            {anchor.preferenceIcon} · {anchor.preferenceLabel}
          </>
        )
        : undefined}
    />
  );
}
