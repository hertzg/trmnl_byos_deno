// Per-phase + end-to-end benches for the fused wasm dither path. Run with `deno bench`.
//
//   native        JS reference pipeline (luma → Floyd-Steinberg). Baseline.
//   copy-in only  memcpy RGB from a JS Uint8Array into wasm linear memory.
//   kernel only   call into wasm with RGB already resident; excludes copy-in/out.
//   fused wasm    full ditherRgb() round-trip — the production path.
//
// (fused wasm) - (kernel only) ≈ JS↔wasm boundary cost; (kernel only) is the SIMD + scalar-FS
// hot loop in isolation. Panel size matches the TRMNL X (1872×1404), which the deinterleave
// loop hits without scalar-tail overhead since 1872 % 16 == 0.

import { filterGrayLuminance } from "../luminance.ts";
import { ditherFloydSteinberg } from "../floyd-steinberg.ts";
import { ditherRgb, getLayout } from "./dither.wasm.ts";
import { ditherFromRgb, memory } from "./dither.wasm";

const W = 1872;
const H = 1404;
const BIT_DEPTH = 4;
const GROUP = `dither ${W}x${H} ${BIT_DEPTH}bpp`;

// Cheap deterministic gradient — only the byte pattern matters, not the visual content.
const rgb = new Uint8Array(W * H * 3);
for (let i = 0; i < rgb.length; i++) rgb[i] = i & 0xff;

// Pre-grow wasm memory + seed RGB once so per-phase benches don't time setup work.
// getLayout() both computes and grows; the result is cached so the in-bench ditherRgb call
// will short-circuit to the same layout without re-checking memory.
const layout = getLayout(W, H);
new Uint8Array(memory.buffer, layout.rgbPtr, W * H * 3).set(rgb);

Deno.bench({ name: "native", group: GROUP, baseline: true }, () => {
  const grays = filterGrayLuminance(rgb);
  ditherFloydSteinberg(grays, { width: W, height: H, bitDepth: BIT_DEPTH });
});

Deno.bench({ name: "copy-in only", group: GROUP }, () => {
  new Uint8Array(memory.buffer, layout.rgbPtr, W * H * 3).set(rgb);
});

Deno.bench({ name: "kernel only", group: GROUP }, () => {
  ditherFromRgb(
    layout.rgbPtr,
    layout.stagingAPtr,
    layout.stagingBPtr,
    layout.outPtr,
    W,
    H,
    BIT_DEPTH,
  );
});

Deno.bench({ name: "fused wasm", group: GROUP }, () => {
  ditherRgb(rgb, { width: W, height: H, bitDepth: BIT_DEPTH });
});
