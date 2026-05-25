// Per-phase + end-to-end benches for the fused wasm dither path. Run with `deno bench`.
//
// "copy-in only"  — memcpy RGB from a JS Uint8Array into wasm linear memory.
// "kernel only"   — call into wasm with RGB already resident; excludes copy-in and copy-out.
// "fused wasm"    — full ditherRgb() round-trip (current production path).
// "native"        — JS reference pipeline (luma → Floyd-Steinberg). Baseline.
//
// Subtracting (copy-in) from (fused wasm) ≈ kernel+overhead-of-view; comparing (kernel only)
// against (fused wasm) tells us how much of the round-trip is buffer traffic vs hot loop.

import { filterGrayLuminance } from "../luminance.ts";
import { ditherFloydSteinberg } from "../floyd-steinberg.ts";
import { ditherRgb } from "./dither.wasm.ts";
import { ditherFromRgb, memory } from "./dither.wasm";

const W = 1800;
const H = 1480;
const BIT_DEPTH = 4;
const GROUP = `dither ${W}x${H} ${BIT_DEPTH}bpp`;

const rgb = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    rgb[i] = (x * 255 / (W - 1)) | 0;
    rgb[i + 1] = (y * 255 / (H - 1)) | 0;
    rgb[i + 2] = ((x + y) * 255 / (W + H - 2)) | 0;
  }
}

// Pre-grow wasm memory once so the per-phase benches don't time memory.grow().
const PAGE_BYTES = 65536;
const align16 = (n: number) => (n + 15) & ~15;
const rgbBytes = align16(W * H * 3);
const stagingBytes = align16((W + 2) * 2);
const outBytes = align16(W * H);
const totalBytes = rgbBytes + stagingBytes * 2 + outBytes;
{
  const have = memory.buffer.byteLength;
  if (totalBytes > have) memory.grow(Math.ceil((totalBytes - have) / PAGE_BYTES));
}
const rgbPtr = 0;
const stagingAPtr = rgbPtr + rgbBytes;
const stagingBPtr = stagingAPtr + stagingBytes;
const outPtr = stagingBPtr + stagingBytes;

// Seed RGB into wasm memory once so "kernel only" runs against real pixels.
new Uint8Array(memory.buffer, rgbPtr, W * H * 3).set(rgb);

Deno.bench({ name: "native", group: GROUP, baseline: true }, () => {
  const grays = filterGrayLuminance(rgb);
  ditherFloydSteinberg(grays, { width: W, height: H, bitDepth: BIT_DEPTH });
});

Deno.bench({ name: "copy-in only", group: GROUP }, () => {
  new Uint8Array(memory.buffer, rgbPtr, rgbBytes).set(rgb);
});

Deno.bench({ name: "kernel only", group: GROUP }, () => {
  ditherFromRgb(rgbPtr, stagingAPtr, stagingBPtr, outPtr, W, H, BIT_DEPTH);
});

Deno.bench({ name: "fused wasm", group: GROUP }, () => {
  ditherRgb(rgb, { width: W, height: H, bitDepth: BIT_DEPTH });
});
