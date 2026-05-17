import type { Result } from "./plugin.ts";

// What the PluginManager produces per call. The Renderer consumes one to
// derive HTML, screenshot, and serve assets to its internal HTTP server.
// `assets` is keyed by the URL path the view references (e.g. `/assets/foo.svg`)
// so the Renderer can route asset fetches directly without a separate manifest.
export type Bundle = {
  result: Result<unknown>;
  assets: Record<string, Uint8Array>;
};
