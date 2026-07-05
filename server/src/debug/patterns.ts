import { ditherFloydSteinberg } from "../render/_internal/dither/floyd-steinberg.ts";
import { encodePng } from "../render/_internal/dither/encode-png.ts";

// Built-in test patterns for debug mode. Each generator produces palette
// indices (0..2^bitDepth-1) for the panel's native resolution and encodes
// them with the same grayscale PNG encoder the dither pipeline uses, so
// what the Device receives is exactly the format it gets in normal mode —
// minus the CDP render. Reaching into render/_internal is deliberate: the
// patterns must go through the identical encode path to be a valid probe.

export type PatternDims = {
  width: number;
  height: number;
  bitDepth: 1 | 2 | 4 | 8;
};

export type PatternSpec = {
  name: string;
  title: string;
  // Shown on the debug panel next to the thumbnail — what the pattern is for.
  desc: string;
};

export const PATTERNS: readonly PatternSpec[] = [
  {
    name: "wedge",
    title: "gray wedge",
    desc: "every gray level as a hard vertical band — measures the panel's level spacing",
  },
  {
    name: "ramp",
    title: "ramp: dithered vs hard",
    desc: "one gradient, top half Floyd-Steinberg dithered, bottom half quantized raw — " +
      "banding on the top half is the panel's, on the bottom half it's expected",
  },
  {
    name: "checker",
    title: "1px checkerboard",
    desc: "pixel-level black/white alternation — should read as uniform mid-gray",
  },
  { name: "black", title: "solid black", desc: "full-field darkest level" },
  { name: "white", title: "solid white", desc: "full-field lightest level" },
];

export function isPattern(name: string): boolean {
  return PATTERNS.some((p) => p.name === name);
}

export async function renderPattern(
  name: string,
  dims: PatternDims,
): Promise<Uint8Array<ArrayBuffer>> {
  const indices = generateIndices(name, dims);
  return await encodePng(indices, dims.width, dims.height, dims.bitDepth);
}

function generateIndices(name: string, dims: PatternDims): Uint8Array {
  const { width, height, bitDepth } = dims;
  const maxLevel = (1 << bitDepth) - 1;

  switch (name) {
    case "wedge": {
      const bands = maxLevel + 1;
      const row = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        row[x] = Math.min(maxLevel, Math.floor((x * bands) / width));
      }
      return tileRow(row, height);
    }
    case "ramp": {
      // Same linear 0→255 gradient twice: the top half goes through the real
      // Floyd-Steinberg kernel, the bottom half is plain nearest-level
      // quantization. Side by side on glass they separate "the dither can't
      // hide it" from "there was never any dither to hide it".
      const half = Math.floor(height / 2);
      const grays = new Float32Array(width * half);
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < width; x++) {
          grays[y * width + x] = (x * 255) / (width - 1);
        }
      }
      const dithered = ditherFloydSteinberg(grays, { width, height: half, bitDepth });
      const out = new Uint8Array(width * height);
      out.set(dithered, 0);
      const step = 255 / maxLevel;
      for (let x = 0; x < width; x++) {
        const q = Math.min(maxLevel, Math.round((x * 255) / (width - 1) / step));
        for (let y = half; y < height; y++) {
          out[y * width + x] = q;
        }
      }
      return out;
    }
    case "checker": {
      const out = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          out[y * width + x] = (x + y) % 2 === 0 ? 0 : maxLevel;
        }
      }
      return out;
    }
    case "black":
      return new Uint8Array(width * height);
    case "white":
      return new Uint8Array(width * height).fill(maxLevel);
    default:
      throw new Error(`unknown test pattern "${name}"`);
  }
}

function tileRow(row: Uint8Array, height: number): Uint8Array {
  const out = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) out.set(row, y * row.length);
  return out;
}
