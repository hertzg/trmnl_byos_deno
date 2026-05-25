// Probe: capture a real CDP screenshot and inspect the PNG structure so the
// specialized decoder can target exactly what Chrome emits.
//
// Run: deno run -A scripts/probe-cdp-png.ts [url]

import { connect } from "@astral/astral";
import { resolveCdpEndpoint } from "../src/render/_internal/cdp.ts";

const TARGET_URL = Deno.args[0] ?? "http://localhost:3000/";
const CDP_URL = Deno.env.get("CDP_URL") ?? "http://localhost:9222";
const WIDTH = 1872;
const HEIGHT = 1404;

const endpoint = await resolveCdpEndpoint(CDP_URL);
const browser = await connect({ endpoint });
const page = await browser.newPage();
const cdp = page.unsafelyGetCelestialBindings();

await Promise.all([
  cdp.Emulation.setDeviceMetricsOverride({
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  }),
  cdp.Page.setLifecycleEventsEnabled({ enabled: true }),
]);

const fcp = new Promise<void>((resolve) => {
  const h: EventListener = (e) => {
    if ((e as CustomEvent<{ name: string }>).detail.name !== "firstContentfulPaint") return;
    cdp.removeEventListener("Page.lifecycleEvent", h);
    resolve();
  };
  cdp.addEventListener("Page.lifecycleEvent", h);
});

await page.goto(TARGET_URL, { waitUntil: "none" });
await fcp;

const { data } = await cdp.Page.captureScreenshot({ format: "png", optimizeForSpeed: true });
const png = Uint8Array.fromBase64(data);

await page.close().catch(() => {});
await browser.close();

const outPath = Deno.args[1] ?? "scripts/fixtures/cdp-sample.png";
await Deno.mkdir("scripts/fixtures", { recursive: true }).catch(() => {});
await Deno.writeFile(outPath, png);
console.log(`saved → ${outPath}`);
console.log(`PNG bytes: ${png.length}`);

// PNG signature
const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
for (let i = 0; i < 8; i++) {
  if (png[i] !== SIG[i]) throw new Error("bad signature");
}
console.log("signature OK");

// Walk chunks
const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
let p = 8;
const chunks: { type: string; len: number; offset: number }[] = [];
let ihdr: {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
} | null = null;
let idatTotal = 0;
let idatCount = 0;
const firstIdatOffsets: number[] = [];

while (p < png.length) {
  const len = dv.getUint32(p);
  const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
  chunks.push({ type, len, offset: p });
  if (type === "IHDR") {
    ihdr = {
      width: dv.getUint32(p + 8),
      height: dv.getUint32(p + 12),
      bitDepth: png[p + 16],
      colorType: png[p + 17],
      compression: png[p + 18],
      filter: png[p + 19],
      interlace: png[p + 20],
    };
  }
  if (type === "IDAT") {
    idatTotal += len;
    idatCount += 1;
    if (idatCount <= 3) firstIdatOffsets.push(p);
  }
  p += 12 + len;
  if (type === "IEND") break;
}

console.log("\nchunks (type × count, total bytes):");
const byType = new Map<string, { count: number; bytes: number }>();
for (const c of chunks) {
  const e = byType.get(c.type) ?? { count: 0, bytes: 0 };
  e.count += 1;
  e.bytes += c.len;
  byType.set(c.type, e);
}
for (const [t, e] of byType) console.log(`  ${t}: ${e.count}× total ${e.bytes} bytes`);

console.log("\nIHDR:", ihdr);

const colorTypeName = ({ 0: "grayscale", 2: "RGB", 3: "palette", 4: "GA", 6: "RGBA" } as Record<
  number,
  string
>)[ihdr!.colorType] ?? "?";
const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ihdr!.colorType];
console.log(`  → ${colorTypeName}, ${channels} channels`);

// Inspect first IDAT zlib header (CMF/FLG → window size + compression level hint)
const idat0 = firstIdatOffsets[0];
const cmf = png[idat0 + 8];
const flg = png[idat0 + 9];
const flevel = (flg >> 6) & 0x3;
const flevelName = ["fastest (1)", "fast (2-3)", "default (4-6)", "max (7-9)"][flevel];
console.log(`\nzlib header (IDAT #1): CMF=0x${cmf.toString(16)} FLG=0x${flg.toString(16)}`);
console.log(`  → window=${1 << (((cmf >> 4) & 0xf) + 8)}, FLEVEL=${flevel} (${flevelName})`);

// Concatenate IDAT data and inflate to inspect filter bytes per row
const idatChunks: Uint8Array[] = [];
for (const c of chunks) {
  if (c.type === "IDAT") idatChunks.push(png.subarray(c.offset + 8, c.offset + 8 + c.len));
}
const idatBlob = new Uint8Array(idatTotal);
{
  let o = 0;
  for (const c of idatChunks) {
    idatBlob.set(c, o);
    o += c.length;
  }
}
console.log(`\nIDAT: ${idatCount} chunks, ${idatTotal} bytes concatenated`);

const ds = new DecompressionStream("deflate");
const inflated = new Uint8Array(
  await new Response(new Blob([idatBlob as BlobPart]).stream().pipeThrough(ds)).arrayBuffer(),
);
const rowStride = ihdr!.width * channels;
const expected = (1 + rowStride) * ihdr!.height;
console.log(`raw scanlines: ${inflated.length} (expected ${expected})`);

const filterHist = [0, 0, 0, 0, 0];
const filterNames = ["None", "Sub", "Up", "Average", "Paeth"];
for (let y = 0; y < ihdr!.height; y++) {
  const f = inflated[y * (1 + rowStride)];
  if (f >= 0 && f <= 4) filterHist[f]++;
  else console.log(`  row ${y}: unexpected filter ${f}`);
}
console.log("\nfilter histogram:");
for (let i = 0; i < 5; i++) {
  console.log(`  ${i} ${filterNames[i].padEnd(8)} ${filterHist[i]}`);
}

console.log("\nfirst 8 rows filter bytes:");
for (let y = 0; y < Math.min(8, ihdr!.height); y++) {
  console.log(`  row ${y}: ${inflated[y * (1 + rowStride)]} (${filterNames[inflated[y * (1 + rowStride)]] ?? "?"})`);
}
