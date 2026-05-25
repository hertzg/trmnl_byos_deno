import { clamp } from "@std/math";

// Sierra-3 (Frankie Sierra, 1989). 3-row, 12-cell kernel; ÷32. Smoother gradients than
// Floyd-Steinberg with less serpentine smearing, at ~3× the inner-loop work.
//   row y:        X  5  3
//   row y+1: 2 4  5  4  2
//   row y+2:    2 3  2
export function ditherSierra3(
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
      const e = (old - q * step) / 32;
      if (x + 1 < width) grays[i + 1] += e * 5;
      if (x + 2 < width) grays[i + 2] += e * 3;
      if (y + 1 < height) {
        if (x - 2 >= 0) grays[i + width - 2] += e * 2;
        if (x - 1 >= 0) grays[i + width - 1] += e * 4;
        grays[i + width] += e * 5;
        if (x + 1 < width) grays[i + width + 1] += e * 4;
        if (x + 2 < width) grays[i + width + 2] += e * 2;
      }
      if (y + 2 < height) {
        if (x - 1 >= 0) grays[i + 2 * width - 1] += e * 2;
        grays[i + 2 * width] += e * 3;
        if (x + 1 < width) grays[i + 2 * width + 1] += e * 2;
      }
    }
  }
  return out;
}
