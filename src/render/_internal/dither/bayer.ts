import { clamp } from "@std/math";

// Bayer 4x4 ordered dithering. Threshold matrix biases the rounding by ±~½ step per pixel,
// giving a stable, deterministic pattern (same input → identical output across renders).
// deno-fmt-ignore
const BAYER_4 = new Uint8Array([
  0 ,  8,  2, 10,
  12,  4, 14,  6,
  3 , 11,  1,  9,
  15,  7, 13,  5,
]);

export function ditherBayer4(
  grays: Float32Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  const maxLevel = (1 << bitDepth) - 1;
  const step = 255 / maxLevel;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      // Bias ranges over (-step/2, +step/2): enough to push the round() into the next bucket.
      const bias = ((BAYER_4[(y & 3) * 4 + (x & 3)] - 7.5) / 16) * step;
      out[i] = clamp(Math.round((grays[i] + bias) / step), 0, maxLevel);
    }
  }
  return out;
}
