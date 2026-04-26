import { decode } from "imagescript";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./config.ts";

const DISPLAY_BMP_IMAGE_SIZE = 48062;
const FILE_HEADER_SIZE = 14;
const INFO_HEADER_SIZE = 40;
const PALETTE_SIZE = 8;
const BITS_PER_PIXEL = 1;

export async function pngTo1BitBmp(png: Uint8Array): Promise<Uint8Array> {
  const img = await decode(png);
  if (img.width !== SCREEN_WIDTH || img.height !== SCREEN_HEIGHT) {
    throw new Error(
      `Expected ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, got ${img.width}x${img.height}`,
    );
  }

  const rgba = new Uint8Array(img.bitmap.buffer, img.bitmap.byteOffset, img.bitmap.byteLength);
  const grayscale = rgbaToGrayscale(rgba, SCREEN_WIDTH, SCREEN_HEIGHT);
  const isEdge = detectEdges(grayscale, SCREEN_WIDTH, SCREEN_HEIGHT);
  const dithered = atkinsonDither(grayscale, SCREEN_WIDTH, SCREEN_HEIGHT);

  return packBmp(grayscale, isEdge, dithered, SCREEN_WIDTH, SCREEN_HEIGHT);
}

function rgbaToGrayscale(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    // Match Jimp's greyscale: 0.2126R + 0.7152G + 0.0722B (Rec. 709 luma)
    out[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  return out;
}

function detectEdges(gs: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const fuzz = 20;
  for (let y = 1; y < h - 1; y++) {
    const yOff = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = yOff + x;
      const g = gs[idx];
      out[idx] = (g < fuzz || g > 255 - fuzz ||
          gs[idx - 1] < fuzz || gs[idx - 1] > 255 - fuzz ||
          gs[idx + 1] < fuzz || gs[idx + 1] > 255 - fuzz ||
          gs[idx - w] < fuzz || gs[idx - w] > 255 - fuzz ||
          gs[idx + w] < fuzz || gs[idx + w] > 255 - fuzz)
        ? 1
        : 0;
    }
  }
  return out;
}

function atkinsonDither(gs: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(gs.length);
  const buf = new Float32Array(gs.length);
  for (let i = 0; i < gs.length; i++) buf[i] = gs[i];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldPx = buf[i];
      const newPx = oldPx < 128 ? 0 : 255;
      result[i] = newPx;
      const err = Math.floor((oldPx - newPx) / 8);

      if (x + 1 < w) buf[i + 1] += err;
      if (x + 2 < w) buf[i + 2] += err;
      if (y + 1 < h && x - 1 >= 0) buf[i + w - 1] += err;
      if (y + 1 < h) buf[i + w] += err;
      if (y + 1 < h && x + 1 < w) buf[i + w + 1] += err;
      if (y + 2 < h) buf[i + w * 2] += err;
    }
  }
  return result;
}

function packBmp(
  grayscale: Uint8Array,
  isEdge: Uint8Array,
  dithered: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const rowSize = Math.floor((w * BITS_PER_PIXEL + 31) / 32) * 4;
  const buf = new Uint8Array(DISPLAY_BMP_IMAGE_SIZE);
  const dv = new DataView(buf.buffer);

  // BMP File Header (14 bytes)
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4D; // 'M'
  dv.setUint32(2, DISPLAY_BMP_IMAGE_SIZE, true);
  dv.setUint32(6, 0, true);
  dv.setUint32(10, FILE_HEADER_SIZE + INFO_HEADER_SIZE + PALETTE_SIZE, true);

  // BMP Info Header (40 bytes)
  dv.setUint32(14, INFO_HEADER_SIZE, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, BITS_PER_PIXEL, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, rowSize * h, true);
  dv.setInt32(38, 0, true);
  dv.setInt32(42, 0, true);
  dv.setUint32(46, 2, true);
  dv.setUint32(50, 2, true);

  // Palette: index 0 = white, index 1 = black (BGRA, little-endian uint32)
  const paletteOffset = FILE_HEADER_SIZE + INFO_HEADER_SIZE;
  dv.setUint32(paletteOffset, 0x00FFFFFF, true);
  dv.setUint32(paletteOffset + 4, 0x00000000, true);

  // Pixel data — bottom-up, MSB-first within each byte
  const dataOffset = FILE_HEADER_SIZE + INFO_HEADER_SIZE + PALETTE_SIZE;
  for (let y = 0; y < h; y++) {
    const targetY = h - 1 - y;
    const yOff = targetY * w;
    const destRow = dataOffset + y * rowSize;

    for (let x = 0; x < w; x += 8) {
      let byte = 0;
      const remaining = Math.min(8, w - x);
      for (let bit = 0; bit < remaining; bit++) {
        const px = x + bit;
        const idx = yOff + px;
        const gray = grayscale[idx];

        let isBlack: boolean;
        if (gray < 10) isBlack = true;
        else if (gray > 240) isBlack = false;
        else if (isEdge[idx]) isBlack = gray < 128;
        else isBlack = dithered[idx] < 128;

        if (isBlack) byte |= 1 << (7 - bit);
      }
      buf[destRow + (x >> 3)] = byte;
    }
  }

  return buf;
}
