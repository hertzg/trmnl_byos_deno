import type { Result } from "./plugin.ts";

// PluginManager's output. Renderer consumes it; `assets` is keyed by URL
// path so the loopback origin can route asset fetches directly.
export type Bundle = {
  result: Result<unknown>;
  assets: Record<string, Uint8Array>;
};
