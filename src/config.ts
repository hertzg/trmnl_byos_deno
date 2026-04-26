function env(key: string, fallback?: string): string {
  const v = Deno.env.get(key) ?? fallback;
  if (v == null) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const DEVICE_MAC = env("BYOS_DEVICE_MAC").toUpperCase();
export const DEVICE_ACCESS_TOKEN = env("BYOS_DEVICE_ACCESS_TOKEN");
export const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN");
export const PORT = parseInt(env("PORT", "3000"), 10);
export const REFRESH_RATE_SECONDS = parseInt(env("REFRESH_RATE_SECONDS", "300"), 10);
export const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");

export const PIXEL_RATIO = parseFloat(env("PIXEL_RATIO", "1.8"));
export const IMAGE_BIT_DEPTH = parseInt(env("IMAGE_BIT_DEPTH", "4"), 10);

// Logical CSS viewport. With PIXEL_RATIO=1.8, chromium produces a 1872x1404
// (or 1404x1872 portrait) bitmap — TRMNL X panel size.
const ORIENTATION = env("ORIENTATION", "landscape");
export const VIEWPORT_W = ORIENTATION === "landscape" ? 1040 : 780;
export const VIEWPORT_H = ORIENTATION === "landscape" ? 780 : 1040;
