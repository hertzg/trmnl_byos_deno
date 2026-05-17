/** @jsxImportSource hono/jsx */

// Board layout — head + row list, branching to `EmptyFrame` when no rows
// survived the pipeline. The empty frame's age stamp is computed against the
// caller-supplied `now` so the value stays accurate against the render time;
// when omitted, the assembler's `fetchedAt` is the safe default.

import type { Board as BoardData } from "./board_assembler.ts";
import CancelStrip from "./CancelStrip.tsx";
import EmptyFrame from "./EmptyFrame.tsx";
import Footnote from "./Footnote.tsx";
import Head from "./Head.tsx";
import Row from "./Row.tsx";

export default function Board(
  { board, now }: { board: BoardData; now?: Date },
) {
  const renderNow = now ?? board.fetchedAt;
  const isEmpty = board.emptyReason !== "none";
  return (
    <div class="slot slot--full">
      {
        /* The "updated HH:MM" stamp was dropped — minute-rolls forced the
          device to repaint a frame with no new info, draining battery. The
          rows already carry their own leave-by times. */
      }
      <Head title="მგზავრობა" />
      {isEmpty ? <EmptyFrame board={board} now={renderNow} /> : (
        <div class="list">
          {board.rows.map((row) =>
            row.kind === "row"
              ? (
                <Row
                  key={row.preferenceKey + row.leaveByDate.toISOString()}
                  row={row}
                />
              )
              : (
                <CancelStrip
                  key={"cancel-" + row.preferenceKey +
                    row.leaveByDate.toISOString()}
                  strip={row}
                />
              )
          )}
        </div>
      )}
      <Footnote clipSummary={board.clipSummary} />
    </div>
  );
}
