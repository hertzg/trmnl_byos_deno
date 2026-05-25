import { decodePNG } from "@img/png";
import { timed } from "../../telemetry/spans.ts";
import { filterGrayLuminance } from "./dither/luminance/luminance.ts";
import { ditherFloydSteinberg } from "./dither/floyd-steinberg/floyd-steinberg.ts";
import { ditherAtkinson } from "./dither/atkinson.ts";
import { ditherSierra3 } from "./dither/sierra3.ts";
import { ditherBayer4 } from "./dither/bayer.ts";
import { ditherNone } from "./dither/none.ts";
import { encodePng } from "./dither/encode-png.ts";
import { ditherRgba as ditherRgbaWasm } from "./dither/wasm/dither.wasm.ts";

// Output is grayscale PNG (color type 0). bitDepth must be 1, 2, 4, or 8 per the PNG spec.
export type DitherMode = "floyd-steinberg" | "atkinson" | "sierra3" | "bayer" | "none";

export interface DitherOptions {
  bitDepth?: 1 | 2 | 4 | 8;
  mode?: DitherMode;
  impl?: "native" | "wasm";
}

export async function dither(
  input: Uint8Array<ArrayBuffer>,
  opts: DitherOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const bitDepth = opts.bitDepth ?? 4;
  const mode = opts.mode ?? "floyd-steinberg";
  const impl = opts.impl ?? "wasm";
  if (impl === "wasm" && mode !== "floyd-steinberg") {
    throw new Error(
      `dither: impl "wasm" only supports mode "floyd-steinberg" — first iteration limitation`,
    );
  }

  const { header, body } = await timed("decode", () => decodePNG(input));
  const { width, height } = header;

  const indices = impl === "wasm"
    ? await timed("lumaDither", () => ditherRgbaWasm(body, { width, height, bitDepth }))
    : await timed("lumaDither", () => nativePipeline(body, width, height, bitDepth, mode));

  return await timed("encode", () => encodePng(indices, width, height, bitDepth));
}

function nativePipeline(
  rgba: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  mode: DitherMode,
): Uint8Array {
  const grays = filterGrayLuminance(rgba);
  switch (mode) {
    case "floyd-steinberg":
      return ditherFloydSteinberg(grays, { width, height, bitDepth });
    case "atkinson":
      return ditherAtkinson(grays, { width, height, bitDepth });
    case "sierra3":
      return ditherSierra3(grays, { width, height, bitDepth });
    case "bayer":
      return ditherBayer4(grays, { width, height, bitDepth });
    case "none":
      return ditherNone(grays, { bitDepth });
  }
}
