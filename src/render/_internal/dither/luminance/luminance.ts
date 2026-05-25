// JS reference implementation of Rec. 709 luminance. Used by the native dither pipeline and by
// the bench/test files that compare it against the fused wasm kernel.

export function filterGrayLuminance(rgb: Uint8Array): Float32Array {
  const grays = new Float32Array(rgb.length / 3);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j++) {
    grays[j] = 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
  }
  return grays;
}
