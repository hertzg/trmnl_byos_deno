import type { Context } from "hono";
import { PUBLIC_URL_ORIGIN } from "../config.ts";

// PUBLIC_URL_ORIGIN env wins (use it behind a reverse proxy); otherwise the device's
// own request tells us how it reached us — Host / X-Forwarded-* headers from the LAN
// call are exactly what the device used to dial in.
export function publicOrigin(c: Context): string {
  if (PUBLIC_URL_ORIGIN) return PUBLIC_URL_ORIGIN;
  const url = new URL(c.req.url);
  const h = c.req.raw.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const proto = h.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
