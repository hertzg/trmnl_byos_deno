import { decodePngCdp } from "./dither/png-decode.ts";
import { timed } from "../../telemetry/spans.ts";
import { encodePng } from "./dither/encode-png.ts";
import { ditherRgb } from "./dither/wasm/dither.wasm.ts";
import { filterGrayLuminance } from "./dither/luminance.ts";
import { ditherFloydSteinberg } from "./dither/floyd-steinberg.ts";

// Output is grayscale PNG (color type 0). bitDepth must be 1, 2, 4, or 8 per the PNG spec.
export type DitherMode = "floyd-steinberg";

// Which luma+dither implementation runs: the fused wasm kernel or the
// plain-TypeScript native pipeline (luminance.ts + floyd-steinberg.ts). The
// two are visually equivalent (see dither.wasm.test.ts); the switch exists so
// either can be picked from config without a code change.
export type DitherEngine = "wasm" | "native";

export interface DitherOptions {
  bitDepth?: 1 | 2 | 4 | 8;
  mode?: DitherMode;
  engine?: DitherEngine;
}

export async function dither(
  input: Uint8Array<ArrayBuffer>,
  opts: DitherOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const bitDepth = opts.bitDepth ?? 4;
  const engine = opts.engine ?? "wasm";

  const { header, body } = await timed("decode", () => decodePngCdp(input));
  const { width, height } = header;

  const indices = await timed(
    "lumaDither",
    () =>
      engine === "native"
        ? ditherFloydSteinberg(filterGrayLuminance(body), { width, height, bitDepth })
        : ditherRgb(body, { width, height, bitDepth }),
  );

  return await timed("encode", () => encodePng(indices, width, height, bitDepth));
}
