import type { Context } from "hono";
import { PUBLIC_URL_ORIGIN } from "../config.ts";
import type { OnDisplayContext } from "../template/loader.ts";

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

// Builds the context handed to the template's onDisplay() each /api/display poll.
// device.id ← "ID" header (MAC); device.panel ← Width/Height headers (null if unset).
export function buildOnDisplayContext(c: Context): OnDisplayContext {
  const headers = c.req.raw.headers;
  const id = headers.get("id") ?? headers.get("ID") ?? "";
  const w = parseInt(headers.get("width") ?? "", 10);
  const h = parseInt(headers.get("height") ?? "", 10);
  const panel = Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
    ? { width: w, height: h }
    : null;
  return { device: { id, panel, headers }, now: new Date() };
}
