/** @jsxImportSource hono/jsx */

// Board layout — the row list, branching to `EmptyFrame` when no rows
// survived the pipeline. The empty frame's age stamp is computed against the
// caller-supplied `now` so the value stays accurate against the render time;
// when omitted, the assembler's `fetchedAt` is the safe default.
//
// Chrome-free by ADR-0011: the head title and the clip-summary footnote were
// dropped so the rows are the only persistent ink on the e-ink panel.

import type { Board as BoardData } from "./board_assembler.ts";
import CancelStrip from "./CancelStrip.tsx";
import EmptyFrame from "./EmptyFrame.tsx";
import Row from "./Row.tsx";

export default function Board(
  { board, now }: { board: BoardData; now?: Date },
) {
  const renderNow = now ?? board.fetchedAt;
  const isEmpty = board.emptyReason !== "none";
  return (
    <>
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
    </>
  );
}
