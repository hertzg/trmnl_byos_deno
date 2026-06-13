import type { Context } from "hono";
import { system } from "../../config/system.ts";

// system.publicUrlOrigin wins (use it behind a reverse proxy); otherwise the device's
// own request tells us how it reached us — Host / X-Forwarded-* headers from the LAN
// call are exactly what the device used to dial in.
export function publicOrigin(c: Context): string {
  if (system.publicUrlOrigin) return system.publicUrlOrigin;
  const url = new URL(c.req.url);
  const h = c.req.raw.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? url.host;
  const proto = h.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
