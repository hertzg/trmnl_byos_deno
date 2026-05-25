// WebAssembly impl of the full dither pipeline (Rec. 709 luminance + Floyd-Steinberg). Hot loop
// is compiled from dither.as.ts; types come from the sidecar dither.wasm.d.ts. JS owns linear
// memory layout: RGB at offset 0, then two (width+2) i16 staging row buffers used by the row-
// by-row fused luma+FS pass, then the tight u8 output. The staging buffers are reused across
// frames; the kernel re-seeds their contents itself, so JS only needs to grow memory once.
//
// We align each segment to 16 bytes so the wasm v128 loads/stores in the luma SIMD body stay
// on natural alignment. The RGB segment additionally pads to a multiple of 32 bytes past the
// last pixel so the SIMD chunk's overlapping v128.load at `p+16` can read freely on the final
// chunk of the final row without falling off the end of the segment.

import { ditherFromRgb as wasmKernel, memory } from "./dither.wasm";

const PAGE_BYTES = 65536;
const align16 = (n: number) => (n + 15) & ~15;

export function ditherRgb(
  rgb: Uint8Array,
  opts: { width: number; height: number; bitDepth: number },
): Uint8Array {
  const { width, height, bitDepth } = opts;
  // The luma SIMD chunk does three back-to-back v128 loads at p, p+16, p+32 (48 bytes total)
  // and the loop only enters when 48 bytes remain readable, so it never reads past the last
  // RGB byte. We still pad to a 16-byte boundary so the staging segment that follows starts
  // aligned for its own v128 stores.
  const rgbBytes = align16(width * height * 3);
  const stagingBytes = align16((width + 2) * 2); // i16 cells
  const outBytes = align16(width * height);
  const totalBytes = rgbBytes + stagingBytes * 2 + outBytes;

  const have = memory.buffer.byteLength;
  if (totalBytes > have) {
    memory.grow(Math.ceil((totalBytes - have) / PAGE_BYTES));
  }

  const rgbPtr = 0;
  const stagingAPtr = rgbPtr + rgbBytes;
  const stagingBPtr = stagingAPtr + stagingBytes;
  const outPtr = stagingBPtr + stagingBytes;

  new Uint8Array(memory.buffer, rgbPtr, width * height * 3).set(rgb);
  wasmKernel(rgbPtr, stagingAPtr, stagingBPtr, outPtr, width, height, bitDepth);
  // Copy out: the next call may grow memory and detach this view.
  return new Uint8Array(memory.buffer, outPtr, width * height);
}
