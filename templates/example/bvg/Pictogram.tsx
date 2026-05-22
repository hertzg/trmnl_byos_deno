/** @jsxImportSource hono/jsx */

// Journey pictogram — one BVG product glyph per leg, line name beside it.
//
//   <walk-fig> 8m · <S-glyph> S5 → <U-glyph> U2 · <walk-fig> 4m
//
// Punctuation rules:
//   "·"  separates a walk from an adjacent transit leg (continuation).
//   "→"  separates two transits (transfer).
//
// The brand shape lives in the glyph (round S/Bus, square U/M, diamond RE,
// circle IC/ICE, walking figure on a white circle that vanishes on paper).
// The line name stays beside the glyph as plain bold text — keeping the full
// name "S7" even when a substitute bus is running it makes the substitution
// visible (BUS-glyph + "S7"), which a digit-only form would collapse.
//
// A walking-only journey collapses to a single figure + N badge.

import type { Leg, TransitLeg, WalkingLeg } from "./journey_client.ts";
import LineGlyph from "./LineGlyph.tsx";

function WalkBadge({ leg }: { leg: WalkingLeg }) {
  return (
    <span class="leg-walk">
      <LineGlyph product="walking" size="md" />
      {leg.durationMinutes}m
    </span>
  );
}

function TransitBadge({ leg }: { leg: TransitLeg }) {
  return (
    <span class="leg-line">
      <LineGlyph product={leg.line.product} size="md" />
      {leg.line.name}
    </span>
  );
}

export default function Pictogram({ legs }: { legs: readonly Leg[] }) {
  // Drop zero-minute walking legs — typical for back-to-back same-station
  // transfers in BVG's response. A 0-minute walk is visual noise.
  const visibleLegs = legs.filter((l) => l.kind !== "walking" || l.durationMinutes > 0);
  if (visibleLegs.length === 0) return <span class="row__pictogram" />;

  // Walking-only special case: render a single figure + N badge.
  const allWalking = visibleLegs.every((l) => l.kind === "walking");
  if (allWalking) {
    const totalMinutes = visibleLegs.reduce(
      (sum, l) => sum + (l.kind === "walking" ? l.durationMinutes : 0),
      0,
    );
    return (
      <span class="row__pictogram">
        <span class="leg-walk">
          <LineGlyph product="walking" size="md" />
          {totalMinutes}m
        </span>
      </span>
    );
  }

  // Mixed: walk · transit → walk · transit → walk.
  const pieces: ReturnType<typeof WalkBadge | typeof TransitBadge>[] = [];
  // Separator between piece i-1 and piece i, indexed by i (i ≥ 1).
  const separators: string[] = [];

  visibleLegs.forEach((leg, i) => {
    if (leg.kind === "walking") {
      pieces.push(<WalkBadge leg={leg} />);
    } else {
      pieces.push(<TransitBadge leg={leg} />);
    }
    if (i === 0) return;
    const prev = visibleLegs[i - 1];
    // The arrow signals "a transit just ended" — stepping out of a transit
    // leg into anything (another transit, a transfer walk, the destination
    // walk). Anything else is a continuation `·`.
    if (prev.kind === "transit") {
      separators.push("→");
    } else {
      separators.push("·");
    }
  });

  return (
    <span class="row__pictogram">
      {pieces.map((piece, i) => (
        <>
          {i > 0 && <span class="leg-arrow">{separators[i - 1]}</span>}
          {piece}
        </>
      ))}
    </span>
  );
}
