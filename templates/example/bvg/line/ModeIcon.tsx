/** @jsxImportSource hono/jsx */

// SVGs live under templates/example/assets/bvg/ and are served by the BYOS at /assets/bvg/*
// (see src/main.ts assetsDir wiring). Originals are from bvg.hafas.cloud — kept locally so
// the rendering browser doesn't need outbound network during a frame. Sizing is set by
// the `.line-row__icon img` rule in style.css.
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

export default function ModeIcon({ product }: { product: string }) {
  const url = PRODUCT_ICONS[product];
  if (!url) return null;
  return <img src={url} alt="" />;
}
