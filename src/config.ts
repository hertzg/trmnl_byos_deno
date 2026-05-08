function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export const PORT = parseInt(env("PORT", "3000"), 10);
// Empty by default — the request's Host/X-Forwarded-* headers are used. Set this only
// to override (e.g. behind a reverse proxy with a different external hostname).
export const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN", "");
export const REFRESH_RATE_SECONDS = parseInt(env("REFRESH_RATE_SECONDS", "3000"), 10);
export const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");

// HTTP base of the CDP container (cloakhq/cloakbrowser cloakserve). The
// per-process WS endpoint is resolved via /json/version on each render.
export const CDP_URL = env("CDP_URL", "http://localhost:9222");
