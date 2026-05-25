import { clamp } from "@std/math";

// No dithering: nearest-level quantization. Posterized but pixel-perfect.
export function ditherNone(grays: Float32Array, opts: { bitDepth: number }): Uint8Array {
  const maxLevel = (1 << opts.bitDepth) - 1;
  const step = 255 / maxLevel;
  const out = new Uint8Array(grays.length);
  for (let i = 0; i < grays.length; i++) {
    out[i] = clamp(Math.round(grays[i] / step), 0, maxLevel);
  }
  return out;
}
