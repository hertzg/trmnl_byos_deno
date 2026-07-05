// WebAssembly impl of the full dither pipeline (Rec. 709 luminance + Floyd-Steinberg). Hot loop
// is compiled from dither.as.ts; types come from the sidecar dither.wasm.d.ts. JS owns the
// linear-memory layout: RGB at offset 0, then two (width+2) i16 staging row buffers used by the
// row-by-row fused luma+FS pass, then the tight u8 output. Each segment is 16-byte aligned so
// the wasm v128 loads/stores in the luma SIMD body stay on natural alignment. The staging
// buffers are reused across frames; the kernel re-seeds their contents itself, so JS only has
// to grow memory once per (larger) frame size.

import { ditherFromRgb as wasmKernel, memory } from "./dither.wasm";

const PAGE_BYTES = 65536;
const align16 = (n: number) => (n + 15) & ~15;

export interface WasmLayout {
  rgbPtr: number;
  stagingAPtr: number;
  stagingBPtr: number;
  outPtr: number;
  totalBytes: number;
}

// Pure layout calculation — given a frame size, returns the offsets the kernel expects.
function computeLayout(width: number, height: number): WasmLayout {
  const rgbBytes = align16(width * height * 3);
  const stagingBytes = align16((width + 2) * 2);
  const outBytes = align16(width * height);
  const rgbPtr = 0;
  const stagingAPtr = rgbPtr + rgbBytes;
  const stagingBPtr = stagingAPtr + stagingBytes;
  const outPtr = stagingBPtr + stagingBytes;
  return {
    rgbPtr,
    stagingAPtr,
    stagingBPtr,
    outPtr,
    totalBytes: rgbBytes + stagingBytes * 2 + outBytes,
  };
}

// Memoized layout. In production the frame size is fixed per device so `getLayout` is hit with
// the same (width, height) every frame — the cache short-circuits to two integer compares + a
// returned reference. Memory grows at most once per distinct (width, height) ever seen; switching
// between sizes (tests, dev) keeps the high-water-mark allocation since wasm memory can't shrink.
let cachedWidth = -1;
let cachedHeight = -1;
let cachedLayout: WasmLayout | null = null;

export function getLayout(width: number, height: number): WasmLayout {
  if (width === cachedWidth && height === cachedHeight && cachedLayout) {
    return cachedLayout;
  }
  const layout = computeLayout(width, height);
  const have = memory.buffer.byteLength;
  if (layout.totalBytes > have) {
    memory.grow(Math.ceil((layout.totalBytes - have) / PAGE_BYTES));
  }
  cachedWidth = width;
  cachedHeight = height;
  cachedLayout = layout;
  return layout;
}

export function ditherRgb(
  rgb: Uint8Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  const layout = getLayout(width, height);

  new Uint8Array(memory.buffer, layout.rgbPtr, width * height * 3).set(rgb);
  wasmKernel(
    layout.rgbPtr,
    layout.stagingAPtr,
    layout.stagingBPtr,
    layout.outPtr,
    width,
    height,
    bitDepth,
  );
  // Copy out: the next call may grow memory and detach this view.
  return new Uint8Array(memory.buffer, layout.outPtr, width * height);
}
