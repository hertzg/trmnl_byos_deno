import { AsyncLocalStorage } from "node:async_hooks";

// Per-request span buffer propagated via AsyncLocalStorage. Shared components
// call `timed(name, fn)` without knowing about Hono; the Hono middleware
// (`withSpans` + `drainSpans`) harvests entries into Server-Timing headers.
// Outside any `withSpans()` context the helpers no-op gracefully — Device-path
// renders and tests just don't record.

export type Span = { name: string; ms: number; parent: string | null };

// `stack` carries the chain of currently-open `timed()` spans so children can
// record their immediate parent at finish time. Server-Timing has no nesting
// concept, but we emit the parent name in the entry's `desc` field — DevTools
// surfaces it inline so the reader can reconstruct the tree.
type Store = { t0: number; spans: Span[]; stack: string[] };

const als = new AsyncLocalStorage<Store>();

// Run `fn` with a fresh span buffer. The buffer is reachable via `drainSpans()`
// after `fn` resolves. `t0` anchors `mark()` offsets.
export function withSpans<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ t0: performance.now(), spans: [], stack: [] }, fn);
}

// Read the current request's spans. Returns [] outside any `withSpans()`.
export function drainSpans(): readonly Span[] {
  return als.getStore()?.spans ?? [];
}

// Record a labeled span around an async step. Returns the resolved value so
// call sites stay assignment-shaped: `const x = await timed("...", () => ...)`.
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const store = als.getStore();
  const parent = store ? (store.stack[store.stack.length - 1] ?? null) : null;
  store?.stack.push(name);
  try {
    return await fn();
  } finally {
    if (store) {
      store.spans.push({ name, ms: performance.now() - start, parent });
      store.stack.pop();
    }
  }
}

// Record a point-in-time marker. The `ms` field carries the offset from the
// request's `withSpans()` start — Server-Timing has no "marker" concept, so
// we encode it as a `dur` value (DevTools renders these as proportional bars,
// longer = later). No-op outside any `withSpans()`.
export function mark(name: string): void {
  const store = als.getStore();
  if (!store) return;
  const parent = store.stack[store.stack.length - 1] ?? null;
  store.spans.push({ name, ms: performance.now() - store.t0, parent });
}
