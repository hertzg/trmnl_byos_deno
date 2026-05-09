import type { Registration, SetupConfig } from "../../src/template/loader.ts";
import Template, { type HNStory } from "./template.tsx";
import { memoize, type MemoizationCacheResult, TtlCache } from "@std/cache";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

const fetchHnItem = memoize(async (id: number): Promise<HNStory> => {
  const r = await fetch(`${HN_BASE}/item/${id}.json`);
  if (!r.ok) throw new Error(`Failed to fetch HN item ${id}: ${r.statusText}`);
  return await r.json() as HNStory;
}, {
  cache: new TtlCache<string, MemoizationCacheResult<Promise<HNStory>>>(60_000),
});

const fetchHnTopIds = memoize(async (): Promise<number[]> => {
  const idsRes = await fetch(`${HN_BASE}/topstories.json`);
  if (!idsRes.ok) {
    throw new Error(`Failed to fetch HN top story IDs: ${idsRes.statusText}`);
  }
  return (await idsRes.json()) as number[];
}, {
  cache: new TtlCache<string, MemoizationCacheResult<Promise<number[]>>>(10_000),
});

async function fetchHNTop(n: number): Promise<HNStory[]> {
  const ids = await fetchHnTopIds();
  return await Promise.all(ids.slice(0, n).map(fetchHnItem));
}

// Lazy template: onDisplay returns fresh JSX each time the renderer asks. The renderer
// decides how often that happens (a single canonical render is shared across all devices
// polling within `validForSeconds`). To pre-render, do the work in setup() and have
// onDisplay return a captured JSX from this closure.
export function setup(_config: SetupConfig): Registration {
  return {
    async onDisplay() {
      const topStories = await fetchHNTop(50);
      return {
        jsx: Template({ topStories }),
        validForSeconds: 60,
      };
    },
  };
}
