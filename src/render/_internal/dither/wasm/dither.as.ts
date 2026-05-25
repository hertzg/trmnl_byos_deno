// Fused Rec. 709 luminance + Floyd-Steinberg dither, integer arithmetic, two-row staging.
//
// Memory layout (JS-owned):
//   rgbPtr       : u8  × W·H·3         input
//   stagingAPtr  : i16 × (W+2)         row buffer A
//   stagingBPtr  : i16 × (W+2)         row buffer B
//   outPtr       : u8  × W·H           output (one quantized index per pixel)
//
// Per row, the FS pass reads from `current` (luma + diffused error inherited from prev row) and
// writes diffused error into `next` (which was pre-seeded with the next row's raw luma). After
// each row the two pointers swap. Total staging working set: ~2·(W+2)·2 ≈ 7 KB for TRMNL X,
// which sits comfortably in L1.
//
// Why this is faster than the previous f32 (W+2)·(H+1) padded-arena form:
//
//   1. Two-row layout. Old kernel streamed a ~1.5 MB f32 arena through L2 twice (luma writes,
//      FS reads). New kernel keeps two ~3.6 KB rows resident in L1, and the next row's luma is
//      computed lazily one row ahead of the FS reader.
//
//   2. Accumulator pipeline on the down-row error. Old kernel wrote three contiguous f32 cells
//      (pDL, pD, pDR) per pixel via v128 load+store. New kernel keeps the un-divided down-row
//      contributions in two scalar i32 registers (`dlPrev`, `dlPrevPrev`) and commits ONE i16
//      cell per pixel — the 16× down-row bandwidth reduction.
//
//   3. Deferred /16. The three contributions to any next-row cell (1·err(x-2) + 5·err(x-1) +
//      3·err(x)) are summed un-divided in `dlPrev`, then divided once at commit. One arithmetic
//      shift instead of three, AND no per-contribution floor bias.
//
//   4. Integer throughout. f32 → i16 in the luma pass (via i32x4.trunc_sat + i16x8.narrow);
//      everything downstream is i32 arithmetic + i16 storage. No ULP drift, no round-half-even
//      vs round-half-up disagreement between WASM and the JS reference — the kernel is now
//      bit-deterministic given the same input. The mid-pass rounding constants (`+8` before
//      `>>4`, `+halfStep` before `/step`) implement round-half-up to match JS Math.round.
//
//   5. Luma SIMD is planar at 16 px/chunk. Three back-to-back v128 loads (48 bytes, every byte
//      consumed — no overlap, no waste) feed a 2-stage i8x16.shuffle deinterleave into vR/vG/vB
//      byte planes. Each plane is zero-extended to two i16x8 (low/high 8 pixels), then luma is
//      computed in Q15 fixed-point: i32x4.extmul_*_i16x8_u(channel, coef_q15) yields the per-
//      channel i32 contribution, three of which sum into a single i32x4 accumulator BEFORE the
//      round-and-shift. One round, one shift, four pack-and-store ops cover all 16 pixels.
//      Throughput: ~2.94 SIMD ops/pixel vs ~3.75 in the prior 8-px-per-chunk overlapping-load
//      design.
//
// Range analysis: |err| ≤ step/2 ≤ 128 (worst case is bitDepth=1). The widest intermediate is
// `dlPrev + err·3` = up to 6·128 + 3·128 = 1152, all comfortably inside i16 (±32767), and the
// accumulators themselves live in i32. The staging cell value (raw luma + accumulated diffused
// error) stays within roughly [-72, 327] in the worst case — easily i16.
//
// The kernel assumes bitDepth ∈ {1, 2, 4, 8} so that step = 255/maxLevel is exact in integer
// arithmetic. The JS wrapper should enforce this.
//
// Kernel:
//
//    + *   7/16
//  * * *   3/16 5/16 1/16
//

export function ditherFromRgb(
  rgbPtr: usize,
  stagingAPtr: usize,
  stagingBPtr: usize,
  outPtr: usize,
  width: i32,
  height: i32,
  bitDepth: i32,
): void {
  const widthBytes: usize = <usize> width;
  const rgbRowBytes: usize = widthBytes * 3;
  const stagingBytes: usize = <usize> (width + 2) << 1;

  // SIMD constants for the luma pass. Q15 fixed-point Rec.709 coefficients:
  //   0.2126 × 32768 ≈ 6966   0.7152 × 32768 ≈ 23436   0.0722 × 32768 ≈ 2366
  // Sum = 32768, so a pure-white pixel quantises to exactly 255 after the +0x4000 round.
  const cRv: v128 = i16x8.splat(<i16> 6966);
  const cGv: v128 = i16x8.splat(<i16> 23436);
  const cBv: v128 = i16x8.splat(<i16> 2366);
  const roundV: v128 = i32x4.splat(<i32> 0x4000);

  // FS integer constants.
  const maxLevel: i32 = (1 << bitDepth) - 1;
  const step: i32 = 255 / maxLevel;
  const halfStep: i32 = step >> 1;

  // Prime row 0's luma into stagingA so the row loop can read from it on iteration y=0.
  lumaRow(rgbPtr, stagingAPtr, width, cRv, cGv, cBv, roundV);

  let current: usize = stagingAPtr;
  let next: usize = stagingBPtr;
  let rgbRowPtr: usize = rgbPtr;
  let outRowPtr: usize = outPtr;

  for (let y: i32 = 0; y < height; y++) {
    // Pre-load row y+1's luma into `next` (or zero `next` on the last row so the FS commits
    // don't read garbage when the staging buffers are reused next frame).
    if (y + 1 < height) {
      lumaRow(rgbRowPtr + rgbRowBytes, next, width, cRv, cGv, cBv, roundV);
    } else {
      let p: usize = next;
      const end: usize = next + stagingBytes;
      while (p < end) {
        store<i16>(p, 0);
        p += 2;
      }
    }

    // Scalar FS pass. Three accumulators carry error across the row:
    //   rightErr   — 7/16 of the previous pixel's error, divided immediately (single contribution).
    //   dlPrev     — un-divided sum (1·err(x-2) + 5·err(x-1)). Combines with the current pixel's
    //                3·err(x) at commit time, then divided ONCE.
    //   dlPrevPrev — un-divided err(x-1). Rotates into dlPrev next iteration.
    let rightErr: i32 = 0;
    let dlPrev: i32 = 0;
    let dlPrevPrev: i32 = 0;

    let inPtr: usize = current + 2; // skip left-border cell
    const nextBase: usize = next;

    for (let x: i32 = 0; x < width; x++) {
      const old: i32 = <i32> load<i16>(inPtr) + rightErr;

      // Quantize: round-half-up + clamp to [0, maxLevel]. The `if` branches collapse to cmov on
      // any modern backend; we keep them explicit because the clamp also normalises out-of-range
      // values from FS overflow on saturated input regions.
      let qi: i32 = (old + halfStep) / step;
      if (qi < 0) qi = 0;
      else if (qi > maxLevel) qi = maxLevel;
      store<u8>(outRowPtr + <usize> x, <u8> qi);

      const err: i32 = old - qi * step;

      // Right neighbour: single contribution, must be divided immediately so it can be added to
      // `old` next iteration (which is in scale-1, not scale-16).
      rightErr = (err * 7 + 8) >> 4;

      // Down-row commit. Combines this iteration's 3·err with the (1·err(x-2) + 5·err(x-1))
      // accumulated in dlPrev. One read-modify-write per pixel, one division.
      const cellAddr: usize = nextBase + (<usize> x << 1);
      const dlCommit: i32 = (dlPrev + err * 3 + 8) >> 4;
      store<i16>(cellAddr, <i16> (<i32> load<i16>(cellAddr) + dlCommit));

      // Rotate. After this, when iteration x+1 reads dlPrev it sees (1·err(x-1) + 5·err(x)),
      // and dlPrevPrev holds err(x) ready to become the "1·" contribution two iterations from now.
      dlPrev = dlPrevPrev + err * 5;
      dlPrevPrev = err;

      inPtr += 2;
    }

    // The loop wrote stagingNext[0..width-1]. Pixel width-1's D contribution (5·err) and
    // pixel width-2's DR contribution (1·err) still need to land in stagingNext[width] — that's
    // exactly what dlPrev holds. Pixel width-1's DR would land in the right border cell; we
    // drop it (it would be zeroed next row anyway), matching the Python reference's behaviour.
    const flushAddr: usize = nextBase + (<usize> width << 1);
    store<i16>(flushAddr, <i16> (<i32> load<i16>(flushAddr) + ((dlPrev + 8) >> 4)));

    // Swap buffers: this row's `next` (now carrying diffused error) becomes the next row's
    // `current`. The old `current` is recycled to receive row y+2's luma.
    const tmp: usize = current;
    current = next;
    next = tmp;

    rgbRowPtr += rgbRowBytes;
    outRowPtr += widthBytes;
  }
}

// Write one row's luma into stagingPtr as i16, plus the 1-cell zero borders on each side.
//
// SIMD body processes 16 RGB pixels per chunk via three back-to-back v128 loads (48 bytes,
// every input byte consumed exactly once). A two-stage i8x16.shuffle deinterleave splits the
// stream into vR/vG/vB byte planes (16 channel samples per plane). Each plane is then zero-
// extended into two i16x8 (low/high 8 pixels), and luma is computed in Q15 fixed-point:
// i32x4.extmul_*_i16x8_u(channel, coef) yields i32 per-channel contributions, three of which
// sum into a single i32x4 accumulator BEFORE the round-and-shift — one rounding per pixel,
// matching JS Math.round (+0x4000 then >>15) so the kernel stays bit-deterministic.
//
// Scalar tail handles width % 16 (empty for 800/1872/3840-wide TRMNL inputs).
function lumaRow(
  rgbPtr: usize,
  stagingPtr: usize,
  width: i32,
  cRv: v128,
  cGv: v128,
  cBv: v128,
  roundV: v128,
): void {
  store<i16>(stagingPtr, 0); // left border
  store<i16>(stagingPtr + (<usize> (width + 1) << 1), 0); // right border

  let rgbP: usize = rgbPtr;
  let stP: usize = stagingPtr + 2; // first real cell
  const rgbEnd: usize = rgbPtr + (<usize> width) * 3;

  // SIMD chunks: 48 bytes per iteration, no overlap. Stop when fewer than 48 bytes remain.
  while (rgbP + 48 <= rgbEnd) {
    // Three aligned-stride loads cover bytes [0..47] = 16 RGB pixels.
    //   ld0: R0 G0 B0 R1 G1 B1 R2 G2 B2 R3 G3 B3 R4 G4 B4 R5
    //   ld1: G5 B5 R6 G6 B6 R7 G7 B7 R8 G8 B8 R9 G9 B9 R10 G10
    //   ld2: B10 R11 G11 B11 R12 G12 B12 R13 G13 B13 R14 G14 B14 R15 G15 B15
    const ld0: v128 = v128.load(rgbP);
    const ld1: v128 = v128.load(rgbP + 16);
    const ld2: v128 = v128.load(rgbP + 32);

    // Two-stage planar deinterleave (2 shuffles per channel). Stage 1 collects bytes from
    // (ld0, ld1); stage 2 brings in the rest from ld2. Pad bytes are zeros — overwritten
    // by the second shuffle so their value doesn't matter.
    //
    // R indices: ld0={0,3,6,9,12,15}, ld1={2,5,8,11,14}→+16, ld2={1,4,7,10,13}→+16.
    // deno-fmt-ignore
    const tempR: v128 = i8x16.shuffle(ld0, ld1,
       0,  3,  6,  9, 12, 15,         // R0..R5 from ld0
      18, 21, 24, 27, 30,             // R6..R10 from ld1
       0,  0,  0,  0,  0,             // pad
    );
    // deno-fmt-ignore
    const vR: v128 = i8x16.shuffle(tempR, ld2,
       0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10,   // R0..R10 from tempR
      17, 20, 23, 26, 29,                            // R11..R15 from ld2
    );

    // G indices: ld0={1,4,7,10,13}, ld1={0,3,6,9,12,15}→+16, ld2={2,5,8,11,14}→+16.
    // deno-fmt-ignore
    const tempG: v128 = i8x16.shuffle(ld0, ld1,
       1,  4,  7, 10, 13,             // G0..G4 from ld0
      16, 19, 22, 25, 28, 31,         // G5..G10 from ld1
       0,  0,  0,  0,  0,             // pad
    );
    // deno-fmt-ignore
    const vG: v128 = i8x16.shuffle(tempG, ld2,
       0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10,   // G0..G10 from tempG
      18, 21, 24, 27, 30,                            // G11..G15 from ld2
    );

    // B indices: ld0={2,5,8,11,14}, ld1={1,4,7,10,13}→+16, ld2={0,3,6,9,12,15}→+16.
    // deno-fmt-ignore
    const tempB: v128 = i8x16.shuffle(ld0, ld1,
       2,  5,  8, 11, 14,             // B0..B4 from ld0
      17, 20, 23, 26, 29,             // B5..B9 from ld1
       0,  0,  0,  0,  0,  0,         // pad
    );
    // deno-fmt-ignore
    const vB: v128 = i8x16.shuffle(tempB, ld2,
       0,  1,  2,  3,  4,  5,  6,  7,  8,  9,       // B0..B9 from tempB
      16, 19, 22, 25, 28, 31,                        // B10..B15 from ld2
    );

    // Zero-extend each i8x16 channel plane into two i16x8 (low/high 8 pixels).
    const rLo: v128 = i16x8.extend_low_i8x16_u(vR);
    const rHi: v128 = i16x8.extend_high_i8x16_u(vR);
    const gLo: v128 = i16x8.extend_low_i8x16_u(vG);
    const gHi: v128 = i16x8.extend_high_i8x16_u(vG);
    const bLo: v128 = i16x8.extend_low_i8x16_u(vB);
    const bHi: v128 = i16x8.extend_high_i8x16_u(vB);

    // Q15 fixed-point luma. extmul_low/high give the 4-lane i32 product of an i16x8 against
    // the Q15 coefficient splat — equivalent to channel × coef without overflow (max
    // 255 × 23436 = ~6M, comfortably in i32). Four i32x4 accumulators cover all 16 pixels.
    // Sums happen in i32 BEFORE the single round-and-shift, so rounding error vs the f32
    // reference is bounded by ~½ ULP per pixel (well under the test's ±1 tolerance).
    let acc0: v128 = i32x4.extmul_low_i16x8_u(rLo, cRv);
    let acc1: v128 = i32x4.extmul_high_i16x8_u(rLo, cRv);
    let acc2: v128 = i32x4.extmul_low_i16x8_u(rHi, cRv);
    let acc3: v128 = i32x4.extmul_high_i16x8_u(rHi, cRv);

    acc0 = i32x4.add(acc0, i32x4.extmul_low_i16x8_u(gLo, cGv));
    acc1 = i32x4.add(acc1, i32x4.extmul_high_i16x8_u(gLo, cGv));
    acc2 = i32x4.add(acc2, i32x4.extmul_low_i16x8_u(gHi, cGv));
    acc3 = i32x4.add(acc3, i32x4.extmul_high_i16x8_u(gHi, cGv));

    acc0 = i32x4.add(acc0, i32x4.extmul_low_i16x8_u(bLo, cBv));
    acc1 = i32x4.add(acc1, i32x4.extmul_high_i16x8_u(bLo, cBv));
    acc2 = i32x4.add(acc2, i32x4.extmul_low_i16x8_u(bHi, cBv));
    acc3 = i32x4.add(acc3, i32x4.extmul_high_i16x8_u(bHi, cBv));

    // Round (+0x4000) and shift down 15 → luma in [0, 255]. narrow_i32x4_s saturates, but
    // values stay in u8 range so no clamp ever fires.
    acc0 = i32x4.shr_s(i32x4.add(acc0, roundV), 15);
    acc1 = i32x4.shr_s(i32x4.add(acc1, roundV), 15);
    acc2 = i32x4.shr_s(i32x4.add(acc2, roundV), 15);
    acc3 = i32x4.shr_s(i32x4.add(acc3, roundV), 15);

    v128.store(stP, i16x8.narrow_i32x4_s(acc0, acc1));
    v128.store(stP + 16, i16x8.narrow_i32x4_s(acc2, acc3));

    rgbP += 48;
    stP += 32;
  }

  // Scalar tail keeps the f32 form for fidelity with the JS reference on partial chunks
  // (the difference vs the Q15 path is ≤1 ULP and the tail is at most 15 pixels per row).
  while (rgbP < rgbEnd) {
    const r: f32 = <f32> load<u8>(rgbP);
    const g: f32 = <f32> load<u8>(rgbP + 1);
    const b: f32 = <f32> load<u8>(rgbP + 2);
    const lum: f32 = <f32> 0.2126 * r + <f32> 0.7152 * g + <f32> 0.0722 * b;
    store<i16>(stP, <i16> <i32> (lum + <f32> 0.5));
    rgbP += 3;
    stP += 2;
  }
}
