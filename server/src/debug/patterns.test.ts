import { assert, assertEquals } from "@std/assert";
import { isPattern, PATTERNS, renderPattern } from "./patterns.ts";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readIhdr(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  // Fixed layout from our own encoder: signature (8) + IHDR len/type (8),
  // then width/height/bitDepth/colorType at 16/20/24/25.
  return {
    width: dv.getUint32(16),
    height: dv.getUint32(20),
    bitDepth: png[24],
    colorType: png[25],
  };
}

Deno.test("every pattern encodes a grayscale PNG at the requested dims", async () => {
  for (const { name } of PATTERNS) {
    const png = await renderPattern(name, { width: 64, height: 32, bitDepth: 4 });
    assertEquals([...png.subarray(0, 8)], PNG_SIGNATURE, `${name}: signature`);
    assertEquals(readIhdr(png), { width: 64, height: 32, bitDepth: 4, colorType: 0 }, name);
  }
});

Deno.test("isPattern accepts every listed pattern and nothing else", () => {
  for (const { name } of PATTERNS) assert(isPattern(name));
  assert(!isPattern("nope"));
  assert(!isPattern(""));
});

Deno.test("unknown pattern name rejects", async () => {
  let threw = false;
  await renderPattern("nope", { width: 8, height: 8, bitDepth: 4 }).catch(() => {
    threw = true;
  });
  assert(threw);
});

// The wedge is the measurement probe, so its levels must be exact: at
// bitDepth 8 and width 256 each column x carries gray level x, verbatim.
Deno.test("wedge emits exact gray levels", async () => {
  const width = 256;
  const height = 2;
  const png = await renderPattern("wedge", { width, height, bitDepth: 8 });
  const scanlines = await inflateIdat(png);
  assertEquals(scanlines.length, (1 + width) * height);
  for (let y = 0; y < height; y++) {
    const row = scanlines.subarray(y * (1 + width), (y + 1) * (1 + width));
    assertEquals(row[0], 0, "filter byte");
    for (let x = 0; x < width; x++) {
      assertEquals(row[1 + x], x, `row ${y} col ${x}`);
    }
  }
});

async function inflateIdat(png: Uint8Array): Promise<Uint8Array> {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const decoder = new TextDecoder();
  const parts: Uint8Array[] = [];
  for (let off = 8; off < png.length;) {
    const len = dv.getUint32(off);
    const type = decoder.decode(png.subarray(off + 4, off + 8));
    if (type === "IDAT") parts.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const blob = new Blob(parts as BlobPart[]);
  return new Uint8Array(
    await new Response(
      blob.stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
}
