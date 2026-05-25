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
//   5. Luma SIMD widened to 8 px/chunk. RGB stride means a 24-byte chunk doesn't align with a
//      v128.load (16 bytes), so the chunk uses two v128 loads at p (pixels 0..3) and p+12
//      (pixels 4..7). Each load straddles 4 RGB pixels in its first 12 bytes — the SAME byte
//      layout — so both halves share one shuffle pattern. Crucially, this keeps the RGBA-era
//      trick of sourcing zero bytes from a second shuffle input (`zero` v128) to free-extend
//      each i8 sample to i32. No AND mask needed.
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

  // SIMD constants for the luma pass.
  const cRv: v128 = f32x4.splat(<f32> 0.2126);
  const cGv: v128 = f32x4.splat(<f32> 0.7152);
  const cBv: v128 = f32x4.splat(<f32> 0.0722);
  const halfV: v128 = f32x4.splat(<f32> 0.5);
  const zero: v128 = i8x16.splat(0);

  // FS integer constants.
  const maxLevel: i32 = (1 << bitDepth) - 1;
  const step: i32 = 255 / maxLevel;
  const halfStep: i32 = step >> 1;

  // Prime row 0's luma into stagingA so the row loop can read from it on iteration y=0.
  lumaRow(rgbPtr, stagingAPtr, width, cRv, cGv, cBv, halfV, zero);

  let current: usize = stagingAPtr;
  let next: usize = stagingBPtr;
  let rgbRowPtr: usize = rgbPtr;
  let outRowPtr: usize = outPtr;

  for (let y: i32 = 0; y < height; y++) {
    // Pre-load row y+1's luma into `next` (or zero `next` on the last row so the FS commits
    // don't read garbage when the staging buffers are reused next frame).
    if (y + 1 < height) {
      lumaRow(rgbRowPtr + rgbRowBytes, next, width, cRv, cGv, cBv, halfV, zero);
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

// Write one row's luma into stagingPtr as i16 (round-half-up to nearest integer), plus the
// 1-cell zero borders on each side. SIMD body processes 8 RGB pixels per chunk: 2× v128 loads
// at p (pixels 0..3 in bytes 0..11) and p+12 (pixels 4..7 in bytes 0..11), shuffle each channel
// byte into the low byte of an i32 lane (free zero-extension via `zero` as second shuffle source),
// MAC with weights, round-and-pack two i32x4 → one i16x8 store. Both halves share one shuffle
// pattern because p+12 starts on a pixel boundary. Tail handles width % 8 in scalar.
function lumaRow(
  rgbPtr: usize,
  stagingPtr: usize,
  width: i32,
  cRv: v128,
  cGv: v128,
  cBv: v128,
  halfV: v128,
  zero: v128,
): void {
  store<i16>(stagingPtr, 0); // left border
  store<i16>(stagingPtr + (<usize> (width + 1) << 1), 0); // right border

  let rgbP: usize = rgbPtr;
  let stP: usize = stagingPtr + 2; // first real cell
  const rgbEnd: usize = rgbPtr + (<usize> width) * 3;

  // SIMD chunks: need 28 readable bytes from rgbP (load at p+12 reads p+12..p+27).
  // Stop when fewer than 28 bytes remain; the scalar tail picks up the leftover.
  while (rgbP + 28 <= rgbEnd) {
    const px0: v128 = v128.load(rgbP);
    const px1: v128 = v128.load(rgbP + 12);

    // Both halves share one shuffle pattern. Each v128 holds 4 RGB pixels in its first 12 bytes:
    //   R: bytes 0, 3, 6, 9      G: bytes 1, 4, 7, 10      B: bytes 2, 5, 8, 11
    // Selecting from `zero` as the second source (indices 16+) gives free zero bytes for the
    // high 3 bytes of each i32 lane.
    // deno-fmt-ignore
    const r0: v128 = i8x16.shuffle(px0, zero,
       0, 16, 16, 16,
       3, 16, 16, 16,
       6, 16, 16, 16,
       9, 16, 16, 16,
    );
    // deno-fmt-ignore
    const g0: v128 = i8x16.shuffle(px0, zero,
       1, 16, 16, 16,
       4, 16, 16, 16,
       7, 16, 16, 16,
      10, 16, 16, 16,
    );
    // deno-fmt-ignore
    const b0: v128 = i8x16.shuffle(px0, zero,
       2, 16, 16, 16,
       5, 16, 16, 16,
       8, 16, 16, 16,
      11, 16, 16, 16,
    );
    const lum0: v128 = f32x4.add(
      f32x4.add(
        f32x4.mul(cRv, f32x4.convert_i32x4_s(r0)),
        f32x4.mul(cGv, f32x4.convert_i32x4_s(g0)),
      ),
      f32x4.mul(cBv, f32x4.convert_i32x4_s(b0)),
    );

    // Pixels 4..7 — same shuffle indices on px1 since the load shifted by 12 lands pixel 4 at
    // byte 0 of px1.
    // deno-fmt-ignore
    const r1: v128 = i8x16.shuffle(px1, zero,
       0, 16, 16, 16,
       3, 16, 16, 16,
       6, 16, 16, 16,
       9, 16, 16, 16,
    );
    // deno-fmt-ignore
    const g1: v128 = i8x16.shuffle(px1, zero,
       1, 16, 16, 16,
       4, 16, 16, 16,
       7, 16, 16, 16,
      10, 16, 16, 16,
    );
    // deno-fmt-ignore
    const b1: v128 = i8x16.shuffle(px1, zero,
       2, 16, 16, 16,
       5, 16, 16, 16,
       8, 16, 16, 16,
      11, 16, 16, 16,
    );
    const lum1: v128 = f32x4.add(
      f32x4.add(
        f32x4.mul(cRv, f32x4.convert_i32x4_s(r1)),
        f32x4.mul(cGv, f32x4.convert_i32x4_s(g1)),
      ),
      f32x4.mul(cBv, f32x4.convert_i32x4_s(b1)),
    );

    // Round-to-nearest via (+0.5 then trunc), saturate to i32, pack two i32x4 into one i16x8.
    // The narrow is saturating, but lum ∈ [0, ~255] never gets near the i16 range so no clamp
    // ever fires.
    const i0: v128 = i32x4.trunc_sat_f32x4_s(f32x4.add(lum0, halfV));
    const i1: v128 = i32x4.trunc_sat_f32x4_s(f32x4.add(lum1, halfV));
    v128.store(stP, i16x8.narrow_i32x4_s(i0, i1));

    rgbP += 24;
    stP += 16;
  }

  // Scalar tail: any remaining pixels (always < 16 px because the SIMD loop stops as soon as
  // fewer than 32 bytes are readable; for the common width=1872 case the tail is empty).
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
