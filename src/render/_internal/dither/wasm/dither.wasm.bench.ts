// Per-phase + end-to-end benches for the fused wasm dither path. Run with `deno bench`.
//
// "copy-in only"  — memcpy RGBA from a JS Uint8Array into wasm linear memory.
// "kernel only"   — call into wasm with RGBA already resident; excludes copy-in and copy-out.
// "fused wasm"    — full ditherRgba() round-trip (current production path).
// "native"        — JS reference pipeline (luma → Floyd-Steinberg). Baseline.
//
// Subtracting (copy-in) from (fused wasm) ≈ kernel+overhead-of-view; comparing (kernel only)
// against (fused wasm) tells us how much of the round-trip is buffer traffic vs hot loop.

import { filterGrayLuminance } from "../luminance/luminance.ts";
import { ditherFloydSteinberg } from "../floyd-steinberg/floyd-steinberg.ts";
import { ditherRgba } from "./dither.wasm.ts";
import { ditherFromRgba, memory } from "./dither.wasm";

const W = 1800;
const H = 1480;
const BIT_DEPTH = 4;
const GROUP = `dither ${W}x${H} ${BIT_DEPTH}bpp`;

const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    rgba[i] = (x * 255 / (W - 1)) | 0;
    rgba[i + 1] = (y * 255 / (H - 1)) | 0;
    rgba[i + 2] = ((x + y) * 255 / (W + H - 2)) | 0;
    rgba[i + 3] = 255;
  }
}

// Pre-grow wasm memory once so the per-phase benches don't time memory.grow().
const PAGE_BYTES = 65536;
const rgbaBytes = W * H * 4;
const paddedBytes = (W + 2) * (H + 1) * 4;
const outBytes = W * H;
const totalBytes = rgbaBytes + paddedBytes + outBytes;
{
  const have = memory.buffer.byteLength;
  if (totalBytes > have) memory.grow(Math.ceil((totalBytes - have) / PAGE_BYTES));
}
const rgbaPtr = 0;
const paddedPtr = rgbaBytes;
const outPtr = paddedPtr + paddedBytes;

Deno.bench({ name: "native", group: GROUP, baseline: true }, () => {
  const grays = filterGrayLuminance(rgba);
  ditherFloydSteinberg(grays, { width: W, height: H, bitDepth: BIT_DEPTH });
});

Deno.bench({ name: "copy-in only", group: GROUP }, () => {
  new Uint8Array(memory.buffer, rgbaPtr, rgbaBytes).set(rgba);
});

Deno.bench({ name: "kernel only", group: GROUP }, () => {
  ditherFromRgba(rgbaPtr, paddedPtr, outPtr, W, H, BIT_DEPTH);
});

Deno.bench({ name: "fused wasm", group: GROUP }, () => {
  ditherRgba(rgba, { width: W, height: H, bitDepth: BIT_DEPTH });
});
