// WebAssembly impl of the full dither pipeline (Rec. 709 luminance + Floyd-Steinberg). Hot loop
// is compiled from dither.as.ts; types come from the sidecar dither.wasm.d.ts. JS owns linear
// memory layout: RGBA at offset 0, then two (width+2) i16 staging row buffers used by the row-
// by-row fused luma+FS pass, then the tight u8 output. The staging buffers are reused across
// frames; the kernel re-seeds their contents itself, so JS only needs to grow memory once.
//
// We align each segment to 16 bytes so the wasm v128 loads/stores in the luma SIMD body stay
// on natural alignment.

import { ditherFromRgba as wasmKernel, memory } from "./dither.wasm";

const PAGE_BYTES = 65536;
const align16 = (n: number) => (n + 15) & ~15;

export function ditherRgba(
  rgba: Uint8Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  const rgbaBytes = align16(width * height * 4);
  const stagingBytes = align16((width + 2) * 2); // i16 cells
  const outBytes = align16(width * height);
  const totalBytes = rgbaBytes + stagingBytes * 2 + outBytes;

  const have = memory.buffer.byteLength;
  if (totalBytes > have) {
    memory.grow(Math.ceil((totalBytes - have) / PAGE_BYTES));
  }

  const rgbaPtr = 0;
  const stagingAPtr = rgbaPtr + rgbaBytes;
  const stagingBPtr = stagingAPtr + stagingBytes;
  const outPtr = stagingBPtr + stagingBytes;

  new Uint8Array(memory.buffer, rgbaPtr, width * height * 4).set(rgba);
  wasmKernel(rgbaPtr, stagingAPtr, stagingBPtr, outPtr, width, height, bitDepth);
  // Copy out: the next call may grow memory and detach this view.
  return new Uint8Array(memory.buffer, outPtr, width * height);
}
