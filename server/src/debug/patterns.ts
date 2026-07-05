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
  {
    name: "frame",
    title: "border + crop frame",
    desc:
      "1px outer border, inset border, and center cross — catches cropping, rotation, and alignment",
  },
  {
    name: "grid",
    title: "orientation grid",
    desc: "asymmetric corner blocks over a grid — confirms orientation and visible panel bounds",
  },
  {
    name: "fine-lines",
    title: "fine line cadence",
    desc: "1px, 2px, and 4px line groups in both axes — exposes dropped rows/columns",
  },
  {
    name: "diagonal",
    title: "diagonal hatch",
    desc:
      "high-contrast diagonal aliasing probe — useful for shimmer, moire, and stair-step artifacts",
  },
  {
    name: "palette",
    title: "palette tiles",
    desc: "every available gray level as equal-area tiles — validates bit-depth mapping",
  },
  {
    name: "ghosting",
    title: "ghosting stress",
    desc:
      "hard black/white regions with shifted gray silhouettes — makes partial-refresh residue visible",
  },
  {
    name: "text-density",
    title: "text density",
    desc: "synthetic small-text rows and rule blocks — checks readability after refresh",
  },
  {
    name: "noise",
    title: "deterministic noise",
    desc:
      "stable full-panel gray noise — reveals stuck pixels, compression quirks, and uneven clearing",
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
  const midLevel = Math.round(maxLevel / 2);
  const lightLevel = Math.round(maxLevel * 0.75);

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
      const denom = Math.max(1, width - 1);
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < width; x++) {
          grays[y * width + x] = (x * 255) / denom;
        }
      }
      const dithered = ditherFloydSteinberg(grays, { width, height: half, bitDepth });
      const out = new Uint8Array(width * height);
      out.set(dithered, 0);
      const step = 255 / maxLevel;
      for (let x = 0; x < width; x++) {
        const q = Math.min(maxLevel, Math.round((x * 255) / denom / step));
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
    case "frame": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      drawFrame(out, width, height, 0, 0, width, height, 0);
      const inset = Math.max(2, Math.floor(Math.min(width, height) / 18));
      drawFrame(out, width, height, inset, inset, width - inset * 2, height - inset * 2, midLevel);
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);
      for (let x = 0; x < width; x++) out[cy * width + x] = 0;
      for (let y = 0; y < height; y++) out[y * width + cx] = 0;
      return out;
    }
    case "grid": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      const spacing = Math.max(4, Math.floor(Math.min(width, height) / 8));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (x % spacing === 0 || y % spacing === 0) out[y * width + x] = lightLevel;
        }
      }
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);
      for (let x = 0; x < width; x++) out[cy * width + x] = 0;
      for (let y = 0; y < height; y++) out[y * width + cx] = 0;
      const mark = Math.max(2, Math.floor(Math.min(width, height) / 8));
      fillRect(out, width, height, 0, 0, mark, mark, 0);
      fillRect(out, width, height, width - mark, 0, mark, mark, midLevel);
      fillRect(out, width, height, 0, height - mark, mark, mark, lightLevel);
      fillRect(out, width, height, width - mark, height - mark, mark, mark, 0);
      return out;
    }
    case "fine-lines": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      const third = Math.max(1, Math.floor(width / 3));
      const half = Math.max(1, Math.floor(height / 2));
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < width; x++) {
          const cadence = x < third ? 2 : x < third * 2 ? 4 : 8;
          if (x % cadence < cadence / 2) out[y * width + x] = 0;
        }
      }
      for (let y = half; y < height; y++) {
        const relY = y - half;
        for (let x = 0; x < width; x++) {
          const cadence = x < third ? 2 : x < third * 2 ? 4 : 8;
          if (relY % cadence < cadence / 2) out[y * width + x] = 0;
        }
      }
      return out;
    }
    case "diagonal": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const major = (x + y) % 12;
          const minor = (x - y + height * 2) % 20;
          if (major < 2) out[y * width + x] = 0;
          else if (minor === 0) out[y * width + x] = midLevel;
        }
      }
      return out;
    }
    case "palette": {
      const out = new Uint8Array(width * height);
      const levels = maxLevel + 1;
      const cols = Math.ceil(Math.sqrt(levels));
      const rows = Math.ceil(levels / cols);
      const cellW = Math.max(1, Math.ceil(width / cols));
      const cellH = Math.max(1, Math.ceil(height / rows));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const col = Math.min(cols - 1, Math.floor(x / cellW));
          const row = Math.min(rows - 1, Math.floor(y / cellH));
          out[y * width + x] = Math.min(maxLevel, row * cols + col);
        }
      }
      return out;
    }
    case "ghosting": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      const stripe = Math.max(4, Math.floor(width / 16));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (Math.floor(x / stripe) % 2 === 0) out[y * width + x] = 0;
        }
      }
      fillRect(out, width, height, width * 0.12, height * 0.16, width * 0.36, height * 0.36, 0);
      fillRect(
        out,
        width,
        height,
        width * 0.22,
        height * 0.28,
        width * 0.36,
        height * 0.36,
        midLevel,
      );
      fillRect(out, width, height, width * 0.55, height * 0.12, width * 0.30, height * 0.72, 0);
      fillRect(
        out,
        width,
        height,
        width * 0.62,
        height * 0.20,
        width * 0.30,
        height * 0.72,
        maxLevel,
      );
      return out;
    }
    case "text-density": {
      const out = new Uint8Array(width * height).fill(maxLevel);
      const margin = Math.max(2, Math.floor(Math.min(width, height) / 24));
      const lineH = Math.max(5, Math.floor(height / 12));
      for (let y = margin; y + lineH < height - margin; y += lineH + 2) {
        let x = margin;
        let word = 0;
        while (x < width - margin) {
          const w = Math.max(3, ((word * 17 + y) % 13) + 4);
          const h = Math.max(1, Math.floor(lineH / 3));
          fillRect(out, width, height, x, y, Math.min(w, width - margin - x), h, 0);
          if ((word + y) % 3 !== 0) {
            fillRect(out, width, height, x, y + h + 1, Math.min(w - 1, width - margin - x), 1, 0);
          }
          x += w + Math.max(2, Math.floor(lineH / 2));
          word++;
        }
      }
      return out;
    }
    case "noise": {
      const out = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
          out[y * width + x] = h % (maxLevel + 1);
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

function fillRect(
  out: Uint8Array,
  width: number,
  height: number,
  x0Raw: number,
  y0Raw: number,
  wRaw: number,
  hRaw: number,
  value: number,
): void {
  const x0 = clamp(Math.floor(x0Raw), 0, width);
  const y0 = clamp(Math.floor(y0Raw), 0, height);
  const x1 = clamp(Math.ceil(x0Raw + wRaw), x0, width);
  const y1 = clamp(Math.ceil(y0Raw + hRaw), y0, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) out[y * width + x] = value;
  }
}

function drawFrame(
  out: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
): void {
  fillRect(out, width, height, x, y, w, 1, value);
  fillRect(out, width, height, x, y + h - 1, w, 1, value);
  fillRect(out, width, height, x, y, 1, h, value);
  fillRect(out, width, height, x + w - 1, y, 1, h, value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function tileRow(row: Uint8Array, height: number): Uint8Array {
  const out = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) out.set(row, y * row.length);
  return out;
}
