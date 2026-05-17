import { AsyncLocalStorage } from "node:async_hooks";

// Lets the dashboard's scrub path collect per-step wall-clock from arbitrarily
// deep call sites (rasterize → CDP → dither) without threading a recorder
// argument through every signature or changing return types.
//
// `withTimings(fn)` opens a collector for `fn`'s async scope. Any `timed(label,
// inner)` running inside that scope records `inner`'s duration under `label`.
// Outside a collector, `timed` is a pass-through — the production poll path
// (which calls the same code) pays nothing.

type Bucket = Record<string, number>;

const storage = new AsyncLocalStorage<Bucket>();

export async function withTimings<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; timings: Record<string, number> }> {
  const bucket: Bucket = {};
  const value = await storage.run(bucket, fn);
  return { value, timings: bucket };
}

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const bucket = storage.getStore();
  if (!bucket) return await fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    bucket[label] = (bucket[label] ?? 0) + (performance.now() - t0);
  }
}

// Sync variant — same accumulator, no Promise wrap. Use for tight CPU loops
// (luminance filter, dither kernel) that don't justify an async boundary.
export function timedSync<T>(label: string, fn: () => T): T {
  const bucket = storage.getStore();
  if (!bucket) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    bucket[label] = (bucket[label] ?? 0) + (performance.now() - t0);
  }
}
