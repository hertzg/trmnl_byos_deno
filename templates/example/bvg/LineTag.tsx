/** @jsxImportSource hono/jsx */
import LineBadge from "./LineBadge.tsx";
import LineGlyph from "./LineGlyph.tsx";

// Glyph + line-code badge as a single inline element. Used by the row layouts
// (WestList, BVGHorizontal cards) where icon and code read together. The hero on the
// full-frame layout uses LineGlyph and LineBadge separately so it can place them on
// different rows.

export type LineTagSize = "xl" | "lg" | "md" | "sm";

export default function LineTag(
  { line, product, size = "md" }: {
    line: string;
    product: string;
    size?: LineTagSize;
  },
) {
  return (
    <span class="line-tag">
      <LineGlyph product={product} size={size} />
      <LineBadge line={line} product={product} size={size} />
    </span>
  );
}
