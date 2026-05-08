import { decodePNG } from "@img/png";
import { crc32 } from "@hertzg/crc";
import { concat } from "@std/bytes";

// TRMNL X firmware expects 4-bit grayscale (color type 0). Width/height are taken from the input.
const BIT_DEPTH = 4;

export async function ditherNative(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const { header, body } = await decodePNG(input);
  const grays = rgbaToGrayscale(body);
  const indices = ditherGrays(grays, header.width, header.height, BIT_DEPTH);
  return await encodePng(indices, header.width, header.height, BIT_DEPTH);
}

// Rec. 709 luminance into a Float32 buffer so error diffusion can spill out of [0, 255].
function rgbaToGrayscale(rgba: Uint8Array): Float32Array {
  const grays = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    grays[j] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return grays;
}

// Floyd-Steinberg error diffusion. Mutates `grays` in place; returns indices in [0, 2^bitDepth - 1].
function ditherGrays(
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
      const q = Math.max(0, Math.min(maxLevel, Math.round(old / step)));
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

