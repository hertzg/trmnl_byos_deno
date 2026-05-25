import { assert, assertEquals } from "@std/assert";
import { filterGrayLuminance } from "../luminance/luminance.ts";
import { ditherFloydSteinberg } from "../floyd-steinberg/floyd-steinberg.ts";
import { ditherRgba as wasm } from "./dither.wasm.ts";

// Seeded RGBA buffer — deterministic across runs without a PRNG dep.
function makeRgba(pixels: number, seed: number): Uint8Array {
  const out = new Uint8Array(pixels * 4);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (s * 2654435761 + 1) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

function nativePipeline(rgba: Uint8Array, width: number, height: number, bitDepth: number) {
  const grays = filterGrayLuminance(rgba);
  return ditherFloydSteinberg(grays, { width, height, bitDepth });
}

// "Visually identical" contract: each pixel may differ by at most 1 quantization level
// (the rounding boundary an f32 sum can plausibly straddle when the f64 reference doesn't),
// and at most 1% of pixels may differ at all. The fused wasm path uses f32 arithmetic for
// speed (~2-3× kernel time vs f64); on real inputs the drift never lands on a visible band.
function assertVisuallyEqual(
  actual: Uint8Array,
  expected: Uint8Array,
  width: number,
  height: number,
) {
  assertEquals(actual.length, expected.length);
  let mismatches = 0;
  let maxDelta = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    if (d > 0) mismatches++;
    if (d > maxDelta) maxDelta = d;
  }
  const total = width * height;
  const pct = mismatches / total;
  assert(
    maxDelta <= 1,
    `max per-pixel delta = ${maxDelta} (allowed 1). mismatches=${mismatches}/${total}`,
  );
  assert(
    pct <= 0.01,
    `mismatch rate ${
      (pct * 100).toFixed(3)
    }% > 1%. mismatches=${mismatches}/${total}, maxDelta=${maxDelta}`,
  );
}

function assertParity(width: number, height: number, bitDepth: number, seed: number) {
  const rgba = makeRgba(width * height, seed);
  const n = nativePipeline(rgba, width, height, bitDepth);
  const w = wasm(rgba, { width, height, bitDepth });
  assertVisuallyEqual(w, n, width, height);
}

Deno.test("fused wasm matches native pipeline (visually): 1bpp 37x23", () => {
  assertParity(37, 23, 1, 1);
});

Deno.test("fused wasm matches native pipeline (visually): 2bpp 64x48", () => {
  assertParity(64, 48, 2, 2);
});

Deno.test("fused wasm matches native pipeline (visually): 4bpp 800x480 (TRMNL)", () => {
  assertParity(800, 480, 4, 3);
});

Deno.test("fused wasm matches native pipeline (visually): 4bpp 1872x1404 (TRMNL X)", () => {
  assertParity(1872, 1404, 4, 4);
});

Deno.test("fused wasm matches native pipeline: all-zero RGBA", () => {
  // Flat inputs hit no rounding boundaries — should be bit-exact even with f32.
  const w = 64, h = 32, bitDepth = 4;
  const rgba = new Uint8Array(w * h * 4);
  const n = nativePipeline(rgba, w, h, bitDepth);
  const ws = wasm(rgba, { width: w, height: h, bitDepth });
  assertEquals(ws, n);
});

Deno.test("fused wasm matches native pipeline: all-255 RGBA", () => {
  const w = 64, h = 32, bitDepth = 4;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  const n = nativePipeline(rgba, w, h, bitDepth);
  const ws = wasm(rgba, { width: w, height: h, bitDepth });
  assertEquals(ws, n);
});

Deno.test("fused wasm matches native pipeline (visually): each channel isolated", () => {
  // Verifies Rec. 709 coefficient order: pure red, pure green, pure blue luminance differ.
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const w = 3, h = 1, bitDepth = 4;
  const n = nativePipeline(rgba, w, h, bitDepth);
  const ws = wasm(rgba, { width: w, height: h, bitDepth });
  assertVisuallyEqual(ws, n, w, h);
});

Deno.test("fused wasm: back-to-back calls don't leak border error", () => {
  // Determinism check: re-zeroing the padded border inside the kernel must produce identical
  // output on the second call. Compares wasm-to-wasm so f32 drift vs the JS reference is moot.
  const w = 257, h = 129, bitDepth = 4;
  const rgba = makeRgba(w * h, 42);
  const first = wasm(rgba, { width: w, height: h, bitDepth });
  // Snapshot before the second call grows/reuses memory under the view.
  const firstCopy = new Uint8Array(first);
  const second = wasm(rgba, { width: w, height: h, bitDepth });
  assertEquals(second, firstCopy);
});
