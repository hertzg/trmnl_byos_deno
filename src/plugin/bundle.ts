import type { Result } from "./plugin.ts";

// PluginManager's output. Renderer consumes it; `assets` is keyed by URL
// path so the loopback origin can route asset fetches directly. The byte
// buffer is narrowed to `ArrayBuffer` (not `SharedArrayBuffer`) so the
// loopback handler can pass them straight to Hono's `c.body` without a cast.
export type Bundle = {
  result: Result<unknown>;
  assets: Record<string, Uint8Array<ArrayBuffer>>;
};
