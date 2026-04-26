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

export const SCREEN_WIDTH = 800;
export const SCREEN_HEIGHT = 480;
export const FRIENDLY_ID = optional("FRIENDLY_ID", "TRMNL");
