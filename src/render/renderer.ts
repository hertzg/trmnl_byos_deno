import type { Bundle } from "../plugin/bundle.ts";
import { hashBundle } from "../hash.ts";
import type { DeviceProfile } from "./profiles.ts";
import { renderUrl, resolveCdpEndpoint } from "./_internal/cdp.ts";
import { ditherNative } from "./_internal/dither.ts";

// The Renderer is the deep module that owns Bundle → Image (ADR-0003,
// CONTEXT.md). Two public methods, both stateless from the caller's
// perspective:
//
//   identity(bundle) — derives HTML internally, hashes (html + assets),
//     returns the truncated hex digest.
//   rasterize(bundle) — derives HTML internally, hands CDP a URL it can
//     fetch, screenshots, dithers, returns PNG bytes.
//
// How CDP, the dither pass, and (for this slice) the public /preview
// indirection are wired together is encapsulated here. For slice #50 the
// `Bundle` parameter is future-proofing — `assets` is not yet consumed by
// `rasterize` because CDP still pulls Plugin output from the public
// /preview route. Slice #51 swaps that out for a loopback origin that
// serves the Bundle directly.

export type Renderer = {
  identity(bundle: Bundle): Promise<string>;
  rasterize(bundle: Bundle): Promise<Uint8Array>;
};

// CDP fetches `url` and returns the PNG bytes for it, dithered to the
// active panel's bit depth. Exposed as an injection seam so tests don't
// need to spin up CDP, and so Dashboard's scrub path can share the same
// helper while Renderer.rasterize's future signature still consumes a
// Bundle directly (slice #54).
export type FetchPngFromUrl = (url: string) => Promise<Uint8Array>;

export type RendererDeps = {
  // The origin CDP can reach our HTTP server on. CDP screenshots
  // `${internalOrigin}/preview` for the Bundle currently in flight. This
  // mechanism is interim — slice #51 replaces it with a loopback origin
  // that serves the Bundle directly without going through the public
  // /preview route.
  internalOrigin: string;
  fetchPngFromUrl: FetchPngFromUrl;
};

export function createRenderer(deps: RendererDeps): Renderer {
  return {
    identity(bundle) {
      return hashBundle(bundle);
    },
    rasterize(_bundle) {
      // For slice #50, CDP still fetches the public /preview route, which
      // re-runs the Plugin server-side. The Bundle argument is part of the
      // future-facing shape; slice #51 wires it through a loopback origin
      // that serves the Bundle's assets directly.
      return deps.fetchPngFromUrl(`${deps.internalOrigin}/preview`);
    },
  };
}

// Production CDP fetcher. `main.ts` builds one and threads it to both
// Renderer (so `rasterize` can resolve its Bundle to PNG bytes) and the
// Dashboard (whose `/preview/png` scrub path passes through the same
// fetcher with the caller's `?t=`/`?intent=` query, until slice #54
// switches Dashboard's no-scrub path over to `renderer.rasterize`).
export type FetchPngFromUrlConfig = {
  cdpUrl: string;
} & DeviceProfile;

export function createFetchPngFromUrl(config: FetchPngFromUrlConfig): FetchPngFromUrl {
  return async (url) => {
    const endpoint = await resolveCdpEndpoint(config.cdpUrl);
    const raw = await renderUrl({
      endpoint,
      url,
      deviceWidth: config.width,
      deviceHeight: config.height,
      // CDP renders at the panel's native resolution with DPR=1; the TRMNL
      // framework CSS handles CSS-to-physical scaling on the page side via
      // `transform: scale(--pixel-ratio)`.
      deviceScaleFactor: 1,
    });
    return await ditherNative(raw as Uint8Array<ArrayBuffer>, {
      bitDepth: config.bitDepth,
      mode: config.dither,
    });
  };
}
