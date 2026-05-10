/** @jsxImportSource hono/jsx */

// Board layout — head + row list. Empty state renders the v3 "nothing to
// show right now" frame, without the next-anchor hint (slice 2/9 add it).

import type { Board as BoardData } from "./board_assembler.ts";
import CancelStrip from "./CancelStrip.tsx";
import Head from "./Head.tsx";
import Row from "./Row.tsx";
import { formatHHMM } from "./time.ts";

export default function Board({ board }: { board: BoardData }) {
  return (
    <div class="slot slot--full">
      <Head
        title="Commute"
        stamp={`updated ${formatHHMM(board.fetchedAt)}`}
      />
      {board.rows.length === 0
        ? (
          <div class="empty">
            <div class="empty__title">nothing to show right now</div>
          </div>
        )
        : (
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
