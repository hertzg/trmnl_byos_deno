import { crc32 } from "@hertzg/crc";
import { concat } from "@std/bytes";

export async function encodePng(
  indices: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
): Promise<Uint8Array<ArrayBuffer>> {
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
