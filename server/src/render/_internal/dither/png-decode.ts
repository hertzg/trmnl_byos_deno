// Specialized PNG decoder for CDP screenshot output.
//
// Chrome's Page.captureScreenshot (format=png, optimizeForSpeed=true) always emits:
//   - 8-bit color type 2 (RGB), non-interlaced
//   - filter method 0 (the standard 5 PNG filters; observed: 100% type 2 "Up")
//   - level-1 zlib-wrapped DEFLATE in IDAT
//
// We assert those invariants on IHDR (Chrome emits nothing else) but still implement
// all five filter types so a Chrome version that flips the heuristic doesn't break
// rendering — the cost of the extra branches is negligible vs the inflate.
//
// Output is RGB8 — three bytes per pixel, no alpha. The WASM dither kernel consumes
// RGB directly, so we never materialise the wasted alpha channel.

const SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export interface DecodedPng {
  header: { width: number; height: number };
  body: Uint8Array<ArrayBuffer>;
}

export async function decodePngCdp(input: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < 8; i++) {
    if (input[i] !== SIG[i]) throw new Error("decodePngCdp: bad PNG signature");
  }

  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let p = 8;
  let width = 0, height = 0;
  const idats: Uint8Array[] = [];

  while (p < input.length) {
    const len = dv.getUint32(p);
    const type = (input[p + 4] << 24) | (input[p + 5] << 16) | (input[p + 6] << 8) | input[p + 7];
    if (type === 0x49484452 /* IHDR */) {
      width = dv.getUint32(p + 8);
      height = dv.getUint32(p + 12);
      const bitDepth = input[p + 16];
      const colorType = input[p + 17];
      const interlace = input[p + 20];
      if (bitDepth !== 8 || colorType !== 2 || interlace !== 0) {
        throw new Error(
          `decodePngCdp: unsupported IHDR (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}); expects 8-bit RGB non-interlaced`,
        );
      }
    } else if (type === 0x49444154 /* IDAT */) {
      idats.push(input.subarray(p + 8, p + 8 + len));
    } else if (type === 0x49454e44 /* IEND */) {
      break;
    }
    p += 12 + len;
  }
  if (!width || !height) throw new Error("decodePngCdp: missing IHDR");
  if (idats.length === 0) throw new Error("decodePngCdp: no IDAT");

  // Stream IDAT chunks through inflate via Blob. Blob accepts the chunk array without
  // a JS-side concat; same pattern encode-png.ts uses for CompressionStream.
  const blob = new Blob(idats as BlobPart[]);
  const filtered = new Uint8Array(
    await new Response(blob.stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
  );

  const stride = width * 3; // RGB
  const expected = (1 + stride) * height;
  if (filtered.length !== expected) {
    throw new Error(`decodePngCdp: inflated ${filtered.length} bytes, expected ${expected}`);
  }

  return { header: { width, height }, body: defilterRgb(filtered, width, height) };
}

// Defilter RGB scanlines straight into the output buffer.
// PNG filter types per scanline (the leading byte): 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth.
// Row 0's "previous" is implicitly all zeros (PNG spec); we synthesize that by branching once.
function defilterRgb(
  filtered: Uint8Array,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const stride = width * 3;
  const out = new Uint8Array(width * height * 3);

  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + stride);
    const filter = filtered[rowOff];
    const src = filtered.subarray(rowOff + 1, rowOff + 1 + stride);
    const dstOff = y * stride;
    const prevOff = dstOff - stride;
    const hasPrev = y > 0;

    switch (filter) {
      case 0:
        out.set(src, dstOff);
        break;
      case 1: // Sub
        for (let i = 0; i < 3; i++) out[dstOff + i] = src[i];
        for (let i = 3; i < stride; i++) {
          out[dstOff + i] = (src[i] + out[dstOff + i - 3]) & 0xff;
        }
        break;
      case 2: // Up — Chrome's hot path
        if (hasPrev) {
          for (let i = 0; i < stride; i++) {
            out[dstOff + i] = (src[i] + out[prevOff + i]) & 0xff;
          }
        } else {
          out.set(src, dstOff);
        }
        break;
      case 3: // Average
        for (let i = 0; i < 3; i++) {
          const up = hasPrev ? out[prevOff + i] : 0;
          out[dstOff + i] = (src[i] + (up >> 1)) & 0xff;
        }
        for (let i = 3; i < stride; i++) {
          const up = hasPrev ? out[prevOff + i] : 0;
          out[dstOff + i] = (src[i] + ((out[dstOff + i - 3] + up) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < 3; i++) {
          const up = hasPrev ? out[prevOff + i] : 0;
          out[dstOff + i] = (src[i] + up) & 0xff;
        }
        for (let i = 3; i < stride; i++) {
          const left = out[dstOff + i - 3];
          const up = hasPrev ? out[prevOff + i] : 0;
          const upLeft = hasPrev ? out[prevOff + i - 3] : 0;
          out[dstOff + i] = (src[i] + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`decodePngCdp: unknown filter type ${filter} at row ${y}`);
    }
  }

  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
