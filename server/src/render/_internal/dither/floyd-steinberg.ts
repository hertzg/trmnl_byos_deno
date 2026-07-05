import { clamp } from "@std/math";

// JS reference Floyd-Steinberg error diffusion. Used by the native dither pipeline and by the
// bench/test files that compare it against the fused wasm kernel. Kernel: 7/16 right, 3/16
// down-left, 5/16 down, 1/16 down-right.
/*

   + *
 * * *

*/
// Grays are copied into a padded (width+2) × (height+1) buffer. The 1-cell border on left/right
// and the row below absorb the diffusion writes that the original code guarded with `if` checks,
// so the inner loop is branchless. Padding cells are never read back, so semantics are preserved
// bit-for-bit.
export function ditherFloydSteinberg(
  grays: Float32Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  const padW = width + 2;
  const padH = height + 1;
  const padded = new Float32Array(padW * padH);
  for (let y = 0; y < height; y++) {
    padded.set(grays.subarray(y * width, (y + 1) * width), y * padW + 1);
  }

  const maxLevel = (1 << bitDepth) - 1;
  const step = 255 / maxLevel;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * padW + (x + 1);
      const old = padded[i];
      const q = clamp(Math.round(old / step), 0, maxLevel);
      out[y * width + x] = q;
      const err = old - q * step;
      padded[i + 1] += (err * 7) / 16;
      padded[i + padW - 1] += (err * 3) / 16;
      padded[i + padW] += (err * 5) / 16;
      padded[i + padW + 1] += (err * 1) / 16;
    }
  }
  return out;
}
