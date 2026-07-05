import { assertEquals, assertRejects } from "@std/assert";
import { decodePNG, encodePNG } from "@img/png";
import { crc32 } from "@hertzg/crc";
import { decodePngCdp } from "./png-decode.ts";

const FIXTURE = "server/scripts/fixtures/cdp-sample.png";

Deno.test("decodePngCdp: real CDP fixture RGB matches @img/png's RGBA (alpha dropped)", async () => {
  const bytes = await Deno.readFile(FIXTURE);
  const ours = await decodePngCdp(bytes);
  const theirs = await decodePNG(bytes.slice()); // @img/png consumes input; clone

  assertEquals(ours.header.width, theirs.header.width);
  assertEquals(ours.header.height, theirs.header.height);
  assertEquals(ours.body.length, ours.header.width * ours.header.height * 3);

  // @img/png returns RGBA; strip alpha and compare.
  const expected = new Uint8Array(ours.body.length);
  for (let i = 0, j = 0; i < theirs.body.length; i += 4, j += 3) {
    expected[j] = theirs.body[i];
    expected[j + 1] = theirs.body[i + 1];
    expected[j + 2] = theirs.body[i + 2];
  }
  assertEquals(ours.body, expected);
});

Deno.test("decodePngCdp: round-trips synthetic RGB image through @img/png encoder", async () => {
  const width = 64;
  const height = 48;
  const rgba = new Uint8Array(width * height * 4);
  const expectedRgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const r = (i * 7) & 0xff, g = (i * 13) & 0xff, b = (i * 23) & 0xff;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 0xff;
    expectedRgb[i * 3] = r;
    expectedRgb[i * 3 + 1] = g;
    expectedRgb[i * 3 + 2] = b;
  }
  const png = await encodePNG(rgba, { width, height, compression: 0, filter: 0, interlace: 0 });

  const ours = await decodePngCdp(png);
  assertEquals(ours.header.width, width);
  assertEquals(ours.header.height, height);
  assertEquals(ours.body, expectedRgb);
});

// Force a specific PNG filter type for every scanline so we can exercise the rarely-
// hit defilter branches that Chrome never produces today.
async function buildRgbPng(
  width: number,
  height: number,
  rgb: Uint8Array,
  filterType: 0 | 1 | 2 | 3 | 4,
): Promise<Uint8Array> {
  const stride = width * 3;
  // Build filtered scanlines: 1-byte filter type + filtered RGB.
  const filtered = new Uint8Array((1 + stride) * height);
  const prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = rgb.subarray(y * stride, (y + 1) * stride);
    const rowOff = y * (1 + stride);
    filtered[rowOff] = filterType;
    const out = filtered.subarray(rowOff + 1, rowOff + 1 + stride);
    switch (filterType) {
      case 0:
        out.set(cur);
        break;
      case 1:
        for (let i = 0; i < 3; i++) out[i] = cur[i];
        for (let i = 3; i < stride; i++) out[i] = (cur[i] - cur[i - 3]) & 0xff;
        break;
      case 2:
        for (let i = 0; i < stride; i++) out[i] = (cur[i] - prev[i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < 3; i++) out[i] = (cur[i] - (prev[i] >> 1)) & 0xff;
        for (let i = 3; i < stride; i++) {
          out[i] = (cur[i] - ((cur[i - 3] + prev[i]) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < 3; i++) out[i] = (cur[i] - prev[i]) & 0xff;
        for (let i = 3; i < stride; i++) {
          const a = cur[i - 3], b = prev[i], c = prev[i - 3];
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          out[i] = (cur[i] - pr) & 0xff;
        }
        break;
    }
    prev.set(cur);
  }
  const idat = new Uint8Array(
    await new Response(
      new Blob([filtered as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 2; // colorType RGB
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  let total = sig.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  out.set(sig, o);
  o += sig.length;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
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

for (const ft of [0, 1, 2, 3, 4] as const) {
  Deno.test(`decodePngCdp: filter type ${ft} round-trips`, async () => {
    const width = 17;
    const height = 11;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 31 + 7) & 0xff;

    const png = await buildRgbPng(width, height, rgb, ft);
    const { header, body } = await decodePngCdp(png);
    assertEquals(header, { width, height });
    assertEquals(body, rgb);
  });
}

Deno.test("decodePngCdp: rejects RGBA color type", async () => {
  const rgba = new Uint8Array(16);
  const png = await encodePNG(rgba, {
    width: 2,
    height: 2,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  // @img/png encodes RGBA by default; verify we reject color type 6.
  // (If @img/png happens to choose RGB here, this test self-skips by also checking IHDR.)
  if (png[25] === 6) {
    await assertRejects(() => decodePngCdp(png), Error, "unsupported IHDR");
  }
});
