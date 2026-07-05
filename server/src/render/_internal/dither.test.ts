import { assertEquals } from "@std/assert";
import { crc32 } from "@hertzg/crc";
import { dither } from "./dither.ts";

// Engine-switch plumbing only — wasm-vs-native output parity is covered in
// depth by dither/wasm/dither.wasm.test.ts. Here a uniform black frame makes
// both pipelines deterministic (no diffusion error to accumulate), so the
// encoded PNGs must be byte-identical.
//
// The input PNG is built by hand (filter 0, colorType 2) because @img/png's
// encoder auto-selects grayscale for uniform frames, and decodePngCdp accepts
// only the 8-bit RGB shape Chrome produces.

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, Number(crc32(out.subarray(4, 8 + data.length))));
  return out;
}

async function blackRgbPng(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const stride = width * 3;
  // All-zero scanlines: filter byte 0 + black RGB, already in filtered form.
  const filtered = new Uint8Array((1 + stride) * height);
  const idat = new Uint8Array(
    await new Response(
      new Blob([filtered as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bitDepth
  ihdr[9] = 2; // colorType RGB
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const chunks = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

Deno.test("dither: engine 'native' and 'wasm' encode an identical PNG for a uniform frame", async () => {
  const input = await blackRgbPng(64, 48);
  const wasm = await dither(input.slice(), { bitDepth: 4, engine: "wasm" });
  const native = await dither(input.slice(), { bitDepth: 4, engine: "native" });
  assertEquals(native, wasm);
});

Deno.test("dither: omitting engine behaves as 'wasm'", async () => {
  const input = await blackRgbPng(64, 48);
  const explicit = await dither(input.slice(), { bitDepth: 4, engine: "wasm" });
  const defaulted = await dither(input.slice(), { bitDepth: 4 });
  assertEquals(defaulted, explicit);
});
