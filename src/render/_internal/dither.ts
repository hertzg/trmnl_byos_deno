import { decodePngCdp } from "./dither/png-decode.ts";
import { timed } from "../../telemetry/spans.ts";
import { filterGrayLuminance } from "./dither/luminance.ts";
import { ditherFloydSteinberg } from "./dither/floyd-steinberg.ts";
import { encodePng } from "./dither/encode-png.ts";
import { ditherRgb as ditherRgbWasm } from "./dither/wasm/dither.wasm.ts";

// Output is grayscale PNG (color type 0). bitDepth must be 1, 2, 4, or 8 per the PNG spec.
export type DitherMode = "floyd-steinberg";

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
  const impl = opts.impl ?? "wasm";

  const { header, body } = await timed("decode", () => decodePngCdp(input));
  const { width, height } = header;

  const indices = impl === "wasm"
    ? await timed("lumaDither", () => ditherRgbWasm(body, { width, height, bitDepth }))
    : await timed("lumaDither", () => nativePipeline(body, width, height, bitDepth));

  return await timed("encode", () => encodePng(indices, width, height, bitDepth));
}

function nativePipeline(
  rgb: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
  const grays = filterGrayLuminance(rgb);
  return ditherFloydSteinberg(grays, { width, height, bitDepth });
}
