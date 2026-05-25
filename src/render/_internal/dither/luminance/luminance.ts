// JS reference implementation of Rec. 709 luminance. Used by the native dither pipeline and by
// the bench/test files that compare it against the fused wasm kernel.

export function filterGrayLuminance(rgba: Uint8Array): Float32Array {
  const grays = new Float32Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    grays[j] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return grays;
}
