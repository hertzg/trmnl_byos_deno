/** @jsxImportSource hono/jsx */

// The black-on-white line-code chip (e.g. "S5", "U5", "240"). S-Bahn lines round to a
// pill so the badge echoes the circular green S glyph; everything else stays
// rectangular to match its (square/rectangular) glyph.

export type LineBadgeSize = "xl" | "lg" | "md" | "sm";

export default function LineBadge(
  { line, product, size = "md" }: {
    line: string;
    product: string;
    size?: LineBadgeSize;
  },
) {
  const shape = product === "suburban" ? " badge--round" : "";
  return <span class={`badge badge--${size}${shape}`}>{line}</span>;
}
