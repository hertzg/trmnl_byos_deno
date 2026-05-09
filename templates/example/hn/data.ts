import { type MemoizationCacheResult, memoize, TtlCache } from "@std/cache";

export type HNStory = {
  id: number;
  title: string;
  score: number;
  by: string;
  descendants?: number;
  url?: string;
  time: number;
};

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

const fetchHnItem = memoize(async (id: number): Promise<HNStory> => {
  const r = await fetch(`${HN_BASE}/item/${id}.json`);
  if (!r.ok) throw new Error(`Failed to fetch HN item ${id}: ${r.statusText}`);
  return await r.json() as HNStory;
}, {
  cache: new TtlCache<string, MemoizationCacheResult<Promise<HNStory>>>(60_000),
});

const fetchHnTopIds = memoize(async (): Promise<number[]> => {
  const r = await fetch(`${HN_BASE}/topstories.json`);
  if (!r.ok) {
    throw new Error(`Failed to fetch HN top story IDs: ${r.statusText}`);
  }
  return (await r.json()) as number[];
}, {
  cache: new TtlCache<string, MemoizationCacheResult<Promise<number[]>>>(
    10_000,
  ),
});

export async function loadHnTop(n: number): Promise<HNStory[]> {
  const ids = await fetchHnTopIds();
  return await Promise.all(ids.slice(0, n).map(fetchHnItem));
}
