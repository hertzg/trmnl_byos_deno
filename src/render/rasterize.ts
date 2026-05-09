import { renderUrl, resolveCdpEndpoint } from "./cdp.ts";
import { type DitherMode, ditherNative } from "./dither.ts";
import type { RasterizeFn } from "./renderer.ts";

export type RasterizeConfig = {
  cdpUrl: string;
  width: number;
  height: number;
  dpr: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
};

// Builds the production rasterize function: hand a URL to CDP, pull back a screenshot,
// dither it to the device-ready PNG.
export function createRasterize(config: RasterizeConfig): RasterizeFn {
  return async (url: string) => {
    const endpoint = await resolveCdpEndpoint(config.cdpUrl);
    const raw = await renderUrl({
      endpoint,
      url,
      deviceWidth: config.width,
      deviceHeight: config.height,
      deviceScaleFactor: config.dpr,
    });
    return await ditherNative(raw as Uint8Array<ArrayBuffer>, {
      bitDepth: config.bitDepth,
      mode: config.dither,
    });
  };
}
