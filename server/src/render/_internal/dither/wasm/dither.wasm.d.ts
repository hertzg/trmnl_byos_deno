export const memory: WebAssembly.Memory;
export function ditherFromRgb(
  rgbPtr: number,
  stagingAPtr: number,
  stagingBPtr: number,
  outPtr: number,
  width: number,
  height: number,
  bitDepth: number,
): void;
