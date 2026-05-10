/** @jsxImportSource hono/jsx */

// Board layout — head + row list, branching to `EmptyFrame` when no rows
// survived the pipeline. The empty frame's age stamp is computed against the
// caller-supplied `now` so the value stays accurate against the render time;
// when omitted, the assembler's `fetchedAt` is the safe default.

import type { Board as BoardData } from "./board_assembler.ts";
import CancelStrip from "./CancelStrip.tsx";
import EmptyFrame from "./EmptyFrame.tsx";
import Head from "./Head.tsx";
import Row from "./Row.tsx";
import { formatHHMM } from "./time.ts";

export default function Board({ board, now }: { board: BoardData; now?: Date }) {
  const renderNow = now ?? board.fetchedAt;
  const isEmpty = board.emptyReason !== "none";
  return (
    <div class="slot slot--full">
      <Head
        title="Commute"
        stamp={`updated ${formatHHMM(board.fetchedAt)}`}
      />
      {isEmpty ? <EmptyFrame board={board} now={renderNow} /> : (
        <div class="list">
          {board.rows.map((row) =>
            row.kind === "row"
              ? <Row key={row.preferenceKey + row.leaveByDate.toISOString()} row={row} />
              : (
                <CancelStrip
                  key={"cancel-" + row.preferenceKey + row.leaveByDate.toISOString()}
                  strip={row}
                />
              )
          )}
        </div>
      )}
    </div>
  );
}
