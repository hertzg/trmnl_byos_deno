import type { Plugin, Result, RunContext } from "@hztrmnl/server/plugin";
import Gallery, { type GalleryState } from "./Gallery.tsx";

// Re-exported for consumers (e.g. @hztrmnl/home) that import GalleryState by
// package name rather than by cross-member relative path.
export type { GalleryState };
import { fetchAlbum, fetchAssetUrl, parseAlbumToken } from "./album.ts";
import { pickPhoto, rotationValidity, VALIDITY_CAP } from "./rotation.ts";
import { ALBUM_URL } from "@hztrmnl/config/plugins/gallery/album";

// The last photo a real Device poll actually saw, kept so a later failed
// fetch can hold it on glass instead of falling through to the error view.
// Updated ONLY on `intent === "poll"` — a dashboard scrub must not move what
// a subsequent poll-time failure holds onto (scrub isolation; precedent:
// transport's 178ec0b keeps scrub runs off production keep-last-good state).
let lastGoodGuid: string | null = null;

// ADR-0002 module shape: default-export a Plugin object directly.
export default {
  async run(ctx: RunContext): Promise<Result<GalleryState>> {
    try {
      const token = parseAlbumToken(ALBUM_URL);
      const photos = await fetchAlbum(token);

      if (photos.length === 0) {
        // Deleting every photo SHOULD blank the panel — this is a real state,
        // never held over from a previous fetch.
        return {
          state: { src: null, note: "The shared album is empty" },
          validity: rotationValidity(photos, ctx.t),
          hints: { identity: "empty" },
          view: Gallery,
        };
      }

      const photo = pickPhoto(photos, ctx.t)!;
      if (ctx.intent === "poll") lastGoodGuid = photo.guid;

      return {
        state: { src: await fetchAssetUrl(token, photo) },
        validity: rotationValidity(photos, ctx.t),
        hints: { identity: `photo:${photo.guid}` },
        view: Gallery,
      };
    } catch (err) {
      // Never leak — the Conductor's error-view fallback carries a 30s
      // validity and would hammer the battery polling a dead album API.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        state: { src: null, note: `Album fetch failed: ${msg}` },
        validity: VALIDITY_CAP,
        hints: {
          identity: `error:${msg}`,
          ...(lastGoodGuid !== null ? { holdIdentity: `photo:${lastGoodGuid}` } : {}),
        },
        view: Gallery,
      };
    }
  },
} satisfies Plugin<GalleryState>;
