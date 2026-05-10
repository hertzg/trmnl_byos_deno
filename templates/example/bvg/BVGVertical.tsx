/** @jsxImportSource hono/jsx */
import type { Board } from "./data.ts";
import Head from "./Head.tsx";
import WestList from "./WestList.tsx";
import { formatHHMM } from "./time.ts";

// 9 rows fit comfortably in the 860 × 1230 vertical slot without crowding. Sparse
// late-night data tails off gracefully — no need for an empty-state placeholder.
const VERTICAL_LIMIT = 9;

export default function BVGVertical(
  { board, fetchedAt }: { board: Board; fetchedAt: Date },
) {
  return (
    <div class="slot slot--vertical">
      <Head
        title={board.title}
        sub={`${board.stop.name} · ${board.stop.walkMin} წუთი ფეხით`}
        stamp={`განახლდა ${formatHHMM(fetchedAt)}`}
      />
      <WestList
        departures={board.departures.slice(0, VERTICAL_LIMIT)}
        withLeavePrefix
      />
    </div>
  );
}
