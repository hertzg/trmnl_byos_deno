// WebAssembly impl of the full dither pipeline (Rec. 709 luminance + Floyd-Steinberg). Hot loop is
// compiled from dither.as.ts; types come from the sidecar dither.wasm.d.ts. JS owns linear memory
// layout: RGBA at offset 0, then the (width+2) × (height+1) f32 padded scratch buffer, then the
// tight u8 output. Border zeroing happens inside the kernel so subsequent frames don't see stale
// diffusion writes.

import { ditherFromRgba as wasmKernel, memory } from "./dither.wasm";

const PAGE_BYTES = 65536;

export function ditherRgba(
  rgba: Uint8Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  const rgbaBytes = width * height * 4;
  const paddedBytes = (width + 2) * (height + 1) * 4;
  const outBytes = width * height;
  const totalBytes = rgbaBytes + paddedBytes + outBytes;

  const have = memory.buffer.byteLength;
  if (totalBytes > have) {
    memory.grow(Math.ceil((totalBytes - have) / PAGE_BYTES));
  }

  const rgbaPtr = 0;
  const paddedPtr = rgbaBytes;
  const outPtr = paddedPtr + paddedBytes;

  new Uint8Array(memory.buffer, rgbaPtr, rgbaBytes).set(rgba);
  wasmKernel(rgbaPtr, paddedPtr, outPtr, width, height, bitDepth);
  // Copy out: the next call may grow memory and detach this view.
  return new Uint8Array(memory.buffer, outPtr, outBytes);
}
