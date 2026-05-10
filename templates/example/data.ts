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

// Dev-only "fake now" override. Set `BVG_FAKE_NOW` to an ISO timestamp (e.g.
// `2026-05-12T08:30:00+02:00`) to pin the board to that instant — useful for
// previewing the layout at different times of day without waiting. BVG's
// `/journeys` is still live, so the simulated time has to be within the feed's
// real horizon (≈ next 7 days) to return useful candidates.
function resolveNow(): Date {
  const raw = Deno.env.get("BVG_FAKE_NOW");
  if (!raw) return new Date();
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(`[bvg] ignoring invalid BVG_FAKE_NOW=${raw}`);
    return new Date();
  }
  return parsed;
}

export async function loadAll(): Promise<{ board: Board; fetchedAt: Date }> {
  const fetchedAt = resolveNow();
  const board = await assembleBoard(ROUTES, fetchedAt);
  return { board, fetchedAt };
}
