import { decodePngCdp } from "./dither/png-decode.ts";
import { timed } from "../../telemetry/spans.ts";
import { encodePng } from "./dither/encode-png.ts";
import { ditherRgb } from "./dither/wasm/dither.wasm.ts";

// Output is grayscale PNG (color type 0). bitDepth must be 1, 2, 4, or 8 per the PNG spec.
export type DitherMode = "floyd-steinberg";

export interface DitherOptions {
  bitDepth?: 1 | 2 | 4 | 8;
  mode?: DitherMode;
}

export async function dither(
  input: Uint8Array<ArrayBuffer>,
  opts: DitherOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const bitDepth = opts.bitDepth ?? 4;

  const { header, body } = await timed("decode", () => decodePngCdp(input));
  const { width, height } = header;

  const indices = await timed("lumaDither", () =>
    ditherRgb(body, { width, height, bitDepth }));

  return await timed("encode", () => encodePng(indices, width, height, bitDepth));
}
