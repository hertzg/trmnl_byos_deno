/** @jsxImportSource hono/jsx */

// Just the BVG product glyph (subway / suburban / bus / tram square in brand color),
// without the line-code badge. Pulled out of LineTag so layouts that want to place
// the glyph and the line code on different rows (e.g. the full-frame hero) can use
// each independently.
//
// SVGs live under templates/example/assets/bvg/ and are served at /assets/bvg/*
// (see src/main.ts assetsDir wiring). Originals come from bvg.hafas.cloud.

const ICON_BASE = "/assets/bvg";

const PRODUCT_ICONS: Record<string, string> = {
  subway: `${ICON_BASE}/haf_prod_sub_t.svg`,
  suburban: `${ICON_BASE}/haf_prod_comm_t.svg`,
  tram: `${ICON_BASE}/haf_prod_tram_t.svg`,
  bus: `${ICON_BASE}/haf_prod_bus_t.svg`,
  express: `${ICON_BASE}/haf_prod_bus_t.svg`,
  regional: `${ICON_BASE}/haf_prod_reg.svg`,
  regionalExp: `${ICON_BASE}/haf_prod_reg.svg`,
  national: `${ICON_BASE}/haf_prod_ic.svg`,
  nationalExpress: `${ICON_BASE}/haf_prod_ice.svg`,
  ferry: `${ICON_BASE}/haf_prod_ship.svg`,
  taxi: `${ICON_BASE}/haf_prod_taxi_t.svg`,
};

export type LineGlyphSize = "xl" | "lg" | "md" | "sm";

export default function LineGlyph(
  { product, size = "md" }: { product: string; size?: LineGlyphSize },
) {
  const icon = PRODUCT_ICONS[product];
  if (!icon) return null;
  return (
    <img
      class={`line-tag__icon line-tag__icon--${size}`}
      src={icon}
      alt=""
    />
  );
}
