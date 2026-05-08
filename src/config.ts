function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export const PORT = parseInt(env("PORT", "3000"), 10);
export const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN", `http://localhost:${PORT}`);
export const REFRESH_RATE_SECONDS = parseInt(env("REFRESH_RATE_SECONDS", "300"), 10);
export const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");

// HTTP base of the CDP container (cloakhq/cloakbrowser cloakserve). The
// per-process WS endpoint is resolved via /json/version on each render.
export const CDP_URL = env("CDP_URL", "http://localhost:9222");
