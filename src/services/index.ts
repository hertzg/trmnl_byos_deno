import { LruCache } from "@std/cache/lru-cache";
import { encodeHex } from "@std/encoding/hex";
import { renderToString } from "hono/jsx/dom/server";
import { renderUrl, resolveCdpEndpoint } from "../render/cdp.ts";
import { type DitherMode, ditherNative } from "../render/dither.ts";

export type RenderOpts = { width?: number; height?: number; dpr?: number };

export type ServicesConfig = {
  cdpUrl: string;
  internalUrlOrigin: string;
  width: number;
  height: number;
  dpr: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
  cacheCapacity?: number;
};

// HTTP path the headless browser fetches stashed HTML from during JSX rasterization.
// Shared between renderJsx (URL construction) and the route handler in main.ts.
export const PREVIEW_PATH = "/preview";

// One bag, two roles. User code only sees `renderJsx`. The HTTP layer also calls
// `bytesFor` (for /render/:token) and `htmlForStash` (for the CDP fetch-back seam
// at PREVIEW_PATH). The split is by convention, not by type — keeps the surface small.
export type Services = {
  renderJsx(jsx: unknown, opts?: RenderOpts): Promise<string>;
  bytesFor(token: string): Uint8Array | undefined;
  htmlForStash(stashKey: string): string | undefined;
};

export function createServices(config: ServicesConfig): Services {
  const cache = new LruCache<string, Uint8Array>(config.cacheCapacity ?? 16);
  const stash = new Map<string, string>();

  return {
    async renderJsx(jsx, opts) {
      const html = "<!DOCTYPE html>" +
        renderToString(jsx as Parameters<typeof renderToString>[0]);
      const stashKey = crypto.randomUUID();
      stash.set(stashKey, html);
      try {
        const endpoint = await resolveCdpEndpoint(config.cdpUrl);
        const raw = await renderUrl({
          endpoint,
          url: `${config.internalUrlOrigin}${PREVIEW_PATH}/${stashKey}`,
          deviceWidth: opts?.width ?? config.width,
          deviceHeight: opts?.height ?? config.height,
          deviceScaleFactor: opts?.dpr ?? config.dpr,
        });
        const png = await ditherNative(raw as Uint8Array<ArrayBuffer>, {
          bitDepth: config.bitDepth,
          mode: config.dither,
        });
        const token = await tokenFromPng(png);
        cache.set(token, png);
        return token;
      } finally {
        stash.delete(stashKey);
      }
    },
    bytesFor(token) {
      return cache.get(token);
    },
    htmlForStash(stashKey) {
      return stash.get(stashKey);
    },
  };
}

// Token = SHA-256 over the device-ready PNG, hex. Hashing post-render means same
// input → same bytes → same token: repeat renders refresh LRU position rather
// than churn.
async function tokenFromPng(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}
