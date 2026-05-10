import type { DeviceState } from "../../src/device.ts";
import { type Board, loadBvgBoard } from "./bvg/data.ts";

// One frame's worth of inputs. main.ts produces this from loadAll() + the latest
// DeviceState; root.tsx consumes it.
export type FrameData = {
  board: Board;
  fetchedAt: Date;
  device: DeviceState;
  nextRefreshAt: Date;
};

export async function loadAll(): Promise<{ board: Board; fetchedAt: Date }> {
  const board = await loadBvgBoard();
  return { board, fetchedAt: new Date() };
}
