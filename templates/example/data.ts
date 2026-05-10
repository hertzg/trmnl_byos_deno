import { type Board, loadBvgBoard } from "./bvg/data.ts";

// One frame's worth of inputs. main.ts produces this; root.tsx consumes it.
export type FrameData = {
  board: Board;
  fetchedAt: Date;
};

export async function loadAll(): Promise<FrameData> {
  const board = await loadBvgBoard();
  return { board, fetchedAt: new Date() };
}
