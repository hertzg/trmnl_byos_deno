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

// TRMNL X panel is 1872x1404 native (landscape). Firmware handles rotation so a
// portrait 1404x1872 image is displayed rotated.
const ORIENTATION = optional("ORIENTATION", "portrait");
export const SCREEN_WIDTH = ORIENTATION === "landscape" ? 1872 : 1404;
export const SCREEN_HEIGHT = ORIENTATION === "landscape" ? 1404 : 1872;

// 4-bit grayscale PNG = native format for TRMNL X (16 grays). Firmware also
// accepts 1-bit and 2-bit PNGs.
export const IMAGE_BIT_DEPTH = parseInt(optional("IMAGE_BIT_DEPTH", "4"), 10);
