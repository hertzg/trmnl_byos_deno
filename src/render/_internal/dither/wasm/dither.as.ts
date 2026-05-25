// Fused Rec. 709 luminance + Floyd-Steinberg error diffusion. Reads RGBA bytes from `rgbaPtr`,
// writes one u8 index per pixel to `outPtr`. Uses `paddedPtr` as a (width+2) × (height+1) f32
// scratch buffer whose 1-cell border absorbs FS boundary writes — the real-pixel cells are
// overwritten by the luma pass every call, but the border cells must be re-zeroed because the
// previous frame's diffusion writes linger there. JS owns memory layout + growth.
//
// Numerics: all arithmetic runs in f32. The "visually identical" parity contract (see
// dither.wasm.test.ts) tolerates ±1 quantization drift on a small fraction of pixels — f32 sums
// can diverge from the JS f64 reference by <1 ULP per op, which never propagates past a single
// round-to-nearest in practice.
//
// Hot-path tricks vs the naive form (cumulative kernel speedup ≈ 2.6× over the baseline f64 form):
//   - One reciprocal hoisted out of the loop: `invStep = maxLevel/255` replaces `/ step`.
//   - Strength-reduced FS weights: precomputed `stepX7_16`, `wDown`, `stepDown` constants —
//     no per-pixel divides at all.
//   - SIMD luma pass (f32x4): one v128 load (4 RGBA pixels) → channel shuffles → f32x4 MAC.
//   - SIMD fused diffusion write for nextRow (pDL, pD, pDR are contiguous): one v128 load +
//     two f32x4 muls + add/sub + one v128 store. Fourth lane is masked to 0 so the store is a
//     no-op on nextRow[i+2].
//   - Inter-pixel critical chain shortened: pR write reformulated as
//     `(pR_old + old*w7_16) - qf*stepX7_16` so the `pR_old + old*w7_16` half runs in parallel
//     with the qf chain. Drops two ops off the load→store→load chain that feeds the next pixel.
//   - Branchless clamp in f32 space: `f32.nearest` + `f32.min`/`f32.max`. Kills the
//     trunc→clamp→convert round-trip through i32 the obvious form leaves in the chain.
//
// Kernel:
//
//    + *   7/16
//  * * *   3/16 5/16 1/16
//

export function ditherFromRgba(
  rgbaPtr: usize,
  paddedPtr: usize,
  outPtr: usize,
  width: i32,
  height: i32,
  bitDepth: i32,
): void {
  const padW: i32 = width + 2;
  const padRowBytes: usize = <usize> padW << 2;
  const widthBytes: usize = <usize> width;
  const rgbaRowBytes: usize = widthBytes << 2;

  // Pass 1: luma → padded (f32). Zero the left/right border cells of each real row so stale FS
  // error from a previous frame doesn't leak into pDL / pR. Inner loop runs 4-px chunks via
  // wasm SIMD: one v128 load (16 RGBA bytes) → shuffles for R/G/B lanes → f32x4 MAC → v128
  // store. Scalar tail handles widths that aren't a multiple of 4.
  const cR: f32 = <f32> 0.2126;
  const cG: f32 = <f32> 0.7152;
  const cB: f32 = <f32> 0.0722;
  const cRv: v128 = f32x4.splat(cR);
  const cGv: v128 = f32x4.splat(cG);
  const cBv: v128 = f32x4.splat(cB);
  const zero: v128 = i8x16.splat(0);

  let rgbaRow: usize = rgbaPtr;
  let padRow: usize = paddedPtr;
  const simdChunks: i32 = width >> 2;
  for (let y: i32 = 0; y < height; y++) {
    store<f32>(padRow, 0); // left border
    let rgbaP: usize = rgbaRow;
    let padP: usize = padRow + 4;

    // Vector body: 4 RGBA pixels (16 bytes) → 4 f32 luminance values (16 bytes).
    for (let c: i32 = 0; c < simdChunks; c++) {
      const px: v128 = v128.load(rgbaP);
      // Shuffle each channel byte into the low byte of a 4-byte lane; remaining 3 lane bytes are
      // zero, so the i32x4 lane = the u8 channel value (no sign extension needed).
      const rb: v128 = i8x16.shuffle(
        px,
        zero,
        0,
        16,
        16,
        16,
        4,
        16,
        16,
        16,
        8,
        16,
        16,
        16,
        12,
        16,
        16,
        16,
      );
      const gb: v128 = i8x16.shuffle(
        px,
        zero,
        1,
        16,
        16,
        16,
        5,
        16,
        16,
        16,
        9,
        16,
        16,
        16,
        13,
        16,
        16,
        16,
      );
      const bb: v128 = i8x16.shuffle(
        px,
        zero,
        2,
        16,
        16,
        16,
        6,
        16,
        16,
        16,
        10,
        16,
        16,
        16,
        14,
        16,
        16,
        16,
      );
      const rf: v128 = f32x4.convert_i32x4_s(rb);
      const gf: v128 = f32x4.convert_i32x4_s(gb);
      const bf: v128 = f32x4.convert_i32x4_s(bb);
      const lum: v128 = f32x4.add(
        f32x4.add(f32x4.mul(cRv, rf), f32x4.mul(cGv, gf)),
        f32x4.mul(cBv, bf),
      );
      v128.store(padP, lum);
      rgbaP += 16;
      padP += 16;
    }

    // Scalar tail: width % 4 leftover pixels.
    const padEnd: usize = padRow + 4 + rgbaRowBytes;
    while (padP < padEnd) {
      const r: f32 = <f32> load<u8>(rgbaP);
      const g: f32 = <f32> load<u8>(rgbaP + 1);
      const b: f32 = <f32> load<u8>(rgbaP + 2);
      store<f32>(padP, cR * r + cG * g + cB * b);
      rgbaP += 4;
      padP += 4;
    }
    store<f32>(padP, 0); // right border

    rgbaRow += rgbaRowBytes;
    padRow += padRowBytes;
  }
  // Bottom border row.
  const bottomEnd: usize = padRow + padRowBytes;
  let p: usize = padRow;
  while (p < bottomEnd) {
    store<f32>(p, 0);
    p += 4;
  }

  // Pass 2: Floyd-Steinberg diffusion. f32 throughout; one reciprocal + one /16 per call. The
  // three down-row diffusion writes (pDL, pD, pDR) are contiguous f32 cells, so we fuse them
  // into one v128 load + f32x4 fmadd + v128 store; the 4th lane is masked to 0 so it preserves
  // nextRow[i+2] (which the next pixel needs intact for its own pDR add). The right-neighbor
  // write (pR) stays scalar because it lives on the current row.
  const maxLevel: i32 = (1 << bitDepth) - 1;
  const maxLevelF: f32 = <f32> maxLevel;
  const step: f32 = <f32> 255.0 / maxLevelF;
  const invStep: f32 = maxLevelF / <f32> 255.0;
  const inv16: f32 = <f32> (1.0 / 16.0);
  const w7_16: f32 = <f32> 7 * inv16;
  // The critical inter-pixel chain runs from load(old) → ... → store(pR) → load(next_old). To
  // shorten it, factor out the `err`: pR_new = pR_old + (old - qf*step)*7/16 expands to
  // (pR_old + old*7/16) - qf*stepX7_16. The `pR_old + old*7/16` half computes in parallel with
  // the qf chain, removing one mul and one sub from the chain. Same trick for the down-row writes.
  const stepX7_16: f32 = step * w7_16;
  // Weights for nextRow [DL, D, DR, _unused_]. Last lane MUST be 0 so the SIMD store is a no-op
  // on nextRow[i+2].
  const wDown: v128 = f32x4(
    <f32> 3 * inv16,
    <f32> 5 * inv16,
    <f32> 1 * inv16,
    <f32> 0,
  );
  const stepDown: v128 = f32x4(
    step * <f32> 3 * inv16,
    step * <f32> 5 * inv16,
    step * <f32> 1 * inv16,
    <f32> 0,
  );

  let inRowPtr: usize = paddedPtr + 4; // first real pixel = padded col 1
  let outRowPtr: usize = outPtr;

  for (let y: i32 = 0; y < height; y++) {
    let inPtr: usize = inRowPtr;
    let outCol: usize = outRowPtr;
    const inEnd: usize = inPtr + rgbaRowBytes;
    while (inPtr < inEnd) {
      const old: f32 = load<f32>(inPtr);

      // Round-to-nearest, then clamp in f32 space so the err computation avoids a round-trip
      // through i32 (no convert_i32_s in the critical chain). f32.nearest is round-half-to-even;
      // the JS reference's Math.round is round-half-up, so a .5 tie can differ — the "visually
      // identical" parity tolerance covers it. f32.min/max enforce the [0, maxLevel] bound
      // branchlessly.
      const qf: f32 = Mathf.min(Mathf.max(f32.nearest(old * invStep), <f32> 0), maxLevelF);
      store<u8>(outCol, <u8> <i32> qf);

      // Scalar right-neighbor write on current row. Factored form: chain is qf → mul → sub → store,
      // and the `pR_old + old*w7_16` add runs in parallel with the qf chain.
      const pR: usize = inPtr + 4;
      store<f32>(pR, load<f32>(pR) + old * w7_16 - qf * stepX7_16);

      // SIMD fused write for the three contiguous next-row neighbors. Same factoring as pR but
      // off the critical chain — splat(old)*wDown + splat(qf) into the same vector arithmetic.
      const pDL: usize = inPtr + padRowBytes - 4;
      const oldV: v128 = f32x4.splat(old);
      const qfV: v128 = f32x4.splat(qf);
      const oldDown: v128 = v128.load(pDL);
      // new = oldDown + old*wDown - qf*stepDown. The 4th lane is 0 in both wDown and stepDown,
      // so it lands at `oldDown lane3 + 0 - 0 = oldDown lane3` — preserves nextRow[i+2].
      const sum: v128 = f32x4.add(oldDown, f32x4.mul(oldV, wDown));
      const sub: v128 = f32x4.sub(sum, f32x4.mul(qfV, stepDown));
      v128.store(pDL, sub);

      inPtr += 4;
      outCol += 1;
    }
    inRowPtr += padRowBytes;
    outRowPtr += widthBytes;
  }
}
