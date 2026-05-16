import { Hono } from "hono";
import type { FetchPngFromUrl } from "./rasterize.ts";

// Bridges the Conductor's `rasterize(html, hints) → png` API to CDP's
// URL-based rendering. CDP can only screenshot a URL, so we shelve the
// HTML under a generated id, hand CDP `${origin}/preview/${id}`, and
// remove the shelf entry once the PNG is back.
//
// The shelf and its serving route are entirely private to this module.
// We export a Hono sub-app that the parent composes via `app.route("/", cdp.app)`
// so the public HTTP layer never has to know that /preview/:id exists or
// that there's a shelf behind it. If we ever swap this CDP-via-URL
// implementation for `Page.setDocumentContent` or anything else, the
// sub-app simply becomes empty and the composition stays the same.

export type CdpRasterize = {
  rasterize: (html: string, hints?: Record<string, unknown>) => Promise<Uint8Array>;
  app: Hono;
};

export type CdpRasterizeDeps = {
  origin: string;
  fetchPngFromUrl: FetchPngFromUrl;
};

export function createCdpRasterize(deps: CdpRasterizeDeps): CdpRasterize {
  const shelf = new Map<string, string>();

  // The route lives under an explicit `__internal` prefix so it can never
  // collide with the application's `/preview` (live HTML at t=now) and
  // `/preview/png` (live PNG at t=now) dev-iteration routes. The path is
  // chosen and used in exactly one place; only CDP ever fetches it.
  const RENDER_PATH = "/__internal/render";

  const rasterize = async (
    html: string,
    _hints?: Record<string, unknown>,
  ): Promise<Uint8Array> => {
    const id = crypto.randomUUID();
    shelf.set(id, html);
    try {
      return await deps.fetchPngFromUrl(`${deps.origin}${RENDER_PATH}/${id}`);
    } finally {
      shelf.delete(id);
    }
  };

  const app = new Hono().get(`${RENDER_PATH}/:id`, (c) => {
    const html = shelf.get(c.req.param("id"));
    if (html === undefined) return c.body(null, 404);
    return c.html(html, 200, { "cache-control": "no-store" });
  });

  return { rasterize, app };
}
