/** @jsxImportSource hono/jsx */
import type { Board } from "./data.ts";
import BVGFull from "./BVGFull.tsx";
import BVGHorizontal from "./BVGHorizontal.tsx";
import BVGVertical from "./BVGVertical.tsx";

// Dispatcher: picks the layout component based on `board.layout`. Falls through to the
// full-frame variant for unknown values, which is a sensible default since this is the
// only template the BYOS renders.

export default function BVGTimetable(
  { board, fetchedAt }: { board: Board; fetchedAt: Date },
) {
  switch (board.layout) {
    case "horizontal":
      return <BVGHorizontal board={board} fetchedAt={fetchedAt} />;
    case "vertical":
      return <BVGVertical board={board} fetchedAt={fetchedAt} />;
    case "full":
    default:
      return <BVGFull board={board} fetchedAt={fetchedAt} />;
  }
}
