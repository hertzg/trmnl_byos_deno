import type { DeviceState } from "../../src/device.ts";
import { assembleBoard, type Board } from "./bvg/board_assembler.ts";
import { ROUTES } from "./bvg/routes.ts";

// One frame's worth of inputs. main.ts produces this from loadAll() + the latest
// DeviceState; root.tsx consumes it.
export type FrameData = {
  board: Board;
  fetchedAt: Date;
  device: DeviceState;
  nextRefreshAt: Date;
};

export async function loadAll(): Promise<{ board: Board; fetchedAt: Date }> {
  const fetchedAt = new Date();
  const board = await assembleBoard(ROUTES, fetchedAt);
  return { board, fetchedAt };
}
