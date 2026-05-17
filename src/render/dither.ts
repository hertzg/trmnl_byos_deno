import { decodePNG } from "@img/png";
import { crc32 } from "@hertzg/crc";
import { concat } from "@std/bytes";
import { clamp } from "@std/math";
import { timed, timedSync } from "./timings.ts";

// Output is grayscale PNG (color type 0). bitDepth must be 1, 2, 4, or 8 per the PNG spec.
export type DitherMode = "floyd-steinberg" | "atkinson" | "sierra3" | "bayer" | "none";

export interface DitherOptions {
  bitDepth?: 1 | 2 | 4 | 8;
  mode?: DitherMode;
}

export async function ditherNative(
  input: Uint8Array<ArrayBuffer>,
  opts: DitherOptions = {},
): Promise<Uint8Array> {
  const bitDepth = opts.bitDepth ?? 4;
  const mode = opts.mode ?? "floyd-steinberg";
  const { header, body } = await timed("dither.decode", () => decodePNG(input));
  const grays = timedSync("dither.luminance", () => filterGrayLumiance(body));
  const indices = timedSync(
    "dither.kernel",
    () => ditherGrays(grays, header.width, header.height, bitDepth, mode),
  );
  return await timed(
    "dither.encode",
    () => encodePng(indices, header.width, header.height, bitDepth),
  );
}

// Rec. 709 luminance into a Float32 buffer so error diffusion can spill out of [0, 255].
function filterGrayLumiance(rgba: Uint8Array): Float32Array {
  const grays = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    grays[j] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return grays;
}

// Dispatches to the chosen algorithm. All return one byte per pixel, value in [0, 2^bitDepth - 1].
function ditherGrays(
  grays: Float32Array,
  width: number,
  height: number,
  bitDepth: number,
  mode: DitherMode,
): Uint8Array {
  switch (mode) {
    case "floyd-steinberg":
      return ditherFloydSteinberg(grays, width, height, bitDepth);
    case "atkinson":
      return ditherAtkinson(grays, width, height, bitDepth);
    case "sierra3":
      return ditherSierra3(grays, width, height, bitDepth);
    case "bayer":
      return ditherBayer4(grays, width, height, bitDepth);
    case "none":
      return ditherNone(grays, bitDepth);
  }
}

// Floyd-Steinberg error diffusion. Kernel: 7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right.
/*

   + *
 * * *

*/
function ditherFloydSteinberg(
  grays: Float32Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
  const maxLevel = (1 << bitDepth) - 1;
  const step = 255 / maxLevel;

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = grays[i];
      const q = clamp(Math.round(old / step), 0, maxLevel);
      out[i] = q;
      const err = old - q * step;
      if (x + 1 < width) grays[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) grays[i + width - 1] += (err * 3) / 16;
        grays[i + width] += (err * 5) / 16;
        if (x + 1 < width) grays[i + width + 1] += (err * 1) / 16;
      }
    }
  }
  return out;
}

// Sierra-3 (Frankie Sierra, 1989). 3-row, 12-cell kernel; ÷32. Smoother gradients than
// Floyd-Steinberg with less serpentine smearing, at ~3× the inner-loop work.
//   row y:        X  5  3
//   row y+1: 2 4  5  4  2
//   row y+2:    2 3  2
function ditherSierra3(
  grays: Float32Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
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

// Atkinson dithering (original Mac/HyperCard). 6-cell kernel, each gets 1/8 of the error;
// only 6/8 of the error is diffused — the loss yields punchier contrast and crisper edges.
function ditherAtkinson(
  grays: Float32Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
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

// Bayer 4x4 ordered dithering. Threshold matrix biases the rounding by ±~½ step per pixel,
// giving a stable, deterministic pattern (same input → identical output across renders).
// deno-fmt-ignore
const BAYER_4 = new Uint8Array([
  0 ,  8,  2, 10,
  12,  4, 14,  6,
  3 , 11,  1,  9,
  15,  7, 13,  5,
]);

function ditherBayer4(
  grays: Float32Array,
  width: number,
  height: number,
  bitDepth: number,
): Uint8Array {
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

// No dithering: nearest-level quantization. Posterized but pixel-perfect.
function ditherNone(grays: Float32Array, bitDepth: number): Uint8Array {
  const maxLevel = (1 << bitDepth) - 1;
  const step = 255 / maxLevel;
  const out = new Uint8Array(grays.length);
  for (let i = 0; i < grays.length; i++) {
    out[i] = clamp(Math.round(grays[i] / step), 0, maxLevel);
  }
  return out;
}

async function encodePng(
  indices: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
): Promise<Uint8Array> {
  // Filtered scanlines: filter byte (0/None) + sub-byte packed samples MSB-first per the PNG spec.
  const samplesPerByte = (8 / bitDepth) | 0;
  const stride = Math.ceil(width / samplesPerByte);
  const scanlines = new Uint8Array((1 + stride) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + stride) + 1;
    for (let x = 0; x < width; x++) {
      const v = indices[y * width + x];
      const shift = (samplesPerByte - 1 - (x % samplesPerByte)) * bitDepth;
      scanlines[rowOff + ((x / samplesPerByte) | 0)] |= v << shift;
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  // ihdr[9..12] stay 0: color_type=grayscale, compression=deflate, filter=adaptive, interlace=none.

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(scanlines)),
    chunk("IEND", new Uint8Array()),
  ]);
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream("deflate") emits zlib-wrapped DEFLATE (RFC 1950) — the format PNG IDAT requires.
  return new Uint8Array(
    await new Response(
      new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(12 + data.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, data.length);
  buf.set(new TextEncoder().encode(type), 4);
  buf.set(data, 8);
  dv.setUint32(8 + data.length, crc32(buf.subarray(4, 8 + data.length)));
  return buf;
}
