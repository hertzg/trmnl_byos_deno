import type { Context } from "hono";

// A configured publicUrlOrigin wins (use it behind a reverse proxy); otherwise the
// device's own request tells us how it reached us — Host / X-Forwarded-* headers from
// the LAN call are exactly what the device used to dial in. Passed in rather than read
// from the config singleton so the object graph stays a pure function of its config.
export function publicOrigin(c: Context, configured: string): string {
  if (configured) return configured;
  const url = new URL(c.req.url);
  const h = c.req.raw.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const proto = h.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
