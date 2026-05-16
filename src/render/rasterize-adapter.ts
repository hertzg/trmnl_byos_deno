import type { HtmlShelf } from "./html-shelf.ts";

// The existing CDP-backed rasterize takes a URL and returns a PNG.
// The Conductor speaks `(html, hints?) → png`. This adapter bridges:
// shelve the html, hand CDP `${origin}/preview/${id}`, remove the
// shelf entry once CDP returns. The `/preview/:id` HTTP route reads
// from the same shelf so CDP can fetch the HTML back.

export type FetchPngFromUrl = (url: string) => Promise<Uint8Array>;

export type RasterizeAdapterDeps = {
  shelf: HtmlShelf;
  origin: string;
  fetchPngFromUrl: FetchPngFromUrl;
};

export function createRasterizeAdapter(deps: RasterizeAdapterDeps) {
  return async (html: string, _hints?: Record<string, unknown>): Promise<Uint8Array> => {
    const id = deps.shelf.shelve(html);
    try {
      return await deps.fetchPngFromUrl(`${deps.origin}/preview/${id}`);
    } finally {
      deps.shelf.remove(id);
    }
  };
}
