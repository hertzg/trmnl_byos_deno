import { type HNStory, loadHnTop } from "./hn/data.ts";
import { loadBvgStops, type Stop } from "./bvg/data.ts";

// One frame's worth of inputs. main.ts produces this; template.tsx consumes it.
export type FrameData = {
  topStories: HNStory[];
  stops: Stop[];
  fetchedAt: Date;
};

export async function loadAll(): Promise<FrameData> {
  const [topStories, stops] = await Promise.all([
    loadHnTop(15),
    loadBvgStops(),
  ]);
  return { topStories, stops, fetchedAt: new Date() };
}
