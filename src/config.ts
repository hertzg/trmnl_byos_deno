function required(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return Deno.env.get(key) ?? fallback;
}

export const DEVICE_MAC = required("BYOS_DEVICE_MAC").toUpperCase();
export const DEVICE_ACCESS_TOKEN = required("BYOS_DEVICE_ACCESS_TOKEN");
export const PUBLIC_URL_ORIGIN = required("PUBLIC_URL_ORIGIN");
export const PORT = parseInt(optional("PORT", "3000"), 10);
export const REFRESH_RATE_SECONDS = parseInt(optional("REFRESH_RATE_SECONDS", "300"), 10);
export const FRIENDLY_ID = optional("FRIENDLY_ID", "TRMNL");

// TRMNL X panel: 1872x1404 physical, model.scale_factor=1.8 → 1040x780 logical CSS pixels.
// Render chromium at the LOGICAL size with DPR=PIXEL_RATIO so the screenshot bitmap
// comes out at the physical resolution (1404x1872 portrait or 1872x1404 landscape).
const ORIENTATION = optional("ORIENTATION", "portrait");
export const PIXEL_RATIO = parseFloat(optional("PIXEL_RATIO", "1.8"));
const LOGICAL_W = 1040;
const LOGICAL_H = 780;
export const VIEWPORT_WIDTH = ORIENTATION === "landscape" ? LOGICAL_W : LOGICAL_H;
export const VIEWPORT_HEIGHT = ORIENTATION === "landscape" ? LOGICAL_H : LOGICAL_W;
export const SCREEN_WIDTH = Math.round(VIEWPORT_WIDTH * PIXEL_RATIO);
export const SCREEN_HEIGHT = Math.round(VIEWPORT_HEIGHT * PIXEL_RATIO);

// 1, 2, 4 (native), 8. Lower = smaller PNG file.
export const IMAGE_BIT_DEPTH = parseInt(optional("IMAGE_BIT_DEPTH", "4"), 10);
