/** @jsxImportSource hono/jsx */
import type { Board } from "./data.ts";
import BVGFull from "./BVGFull.tsx";

// Dispatcher: picks the layout component based on `board.layout`. Falls through to the
// full-frame variant for unknown values, which is a sensible default since this is the
// only template the BYOS renders.

export default function BVGTimetable(
  { board, fetchedAt }: { board: Board; fetchedAt: Date },
) {
  switch (board.layout) {
    default:
      return <BVGFull board={board} fetchedAt={fetchedAt} />;
  }
}
