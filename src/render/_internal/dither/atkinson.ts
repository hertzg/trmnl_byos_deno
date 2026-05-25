import { clamp } from "@std/math";

// Atkinson dithering (original Mac/HyperCard). 6-cell kernel, each gets 1/8 of the error;
// only 6/8 of the error is diffused — the loss yields punchier contrast and crisper edges.
export function ditherAtkinson(
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
      const old = grays[i];
      const q = clamp(Math.round(old / step), 0, maxLevel);
      out[i] = q;
      const e = (old - q * step) / 8;
      if (x + 1 < width) grays[i + 1] += e;
      if (x + 2 < width) grays[i + 2] += e;
      if (y + 1 < height) {
        if (x > 0) grays[i + width - 1] += e;
        grays[i + width] += e;
        if (x + 1 < width) grays[i + width + 1] += e;
      }
      if (y + 2 < height) grays[i + 2 * width] += e;
    }
  }
  return out;
}
