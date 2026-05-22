import type { Plugin, Result, RunContext } from "../../../src/plugin/plugin.ts";
import Gallery, { type GalleryState } from "./Gallery.tsx";
import { pickPhoto, rotationValidity } from "./rotation.ts";

// The set of photos is stable for the lifetime of the process — it reflects the
// files on disk at startup, not at call time. Discovery at module-load keeps
// `run` a pure function of `ctx.t` and avoids redundant filesystem access on
// every poll. (The photos themselves don't change without a process restart.)
const photos = discoverPhotos();

/**
 * Read `assets/gallery/` relative to this module's location and return sorted,
 * URL-path-mapped entries.  Returns `[]` if the directory is absent (it does
 * not exist until the Super-Plugin's merged asset tree is populated by a
 * later PR) or empty.
 */
function discoverPhotos(): string[] {
  const galleryDir = new URL("../assets/gallery/", import.meta.url);
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(galleryDir)];
  } catch {
    // Directory does not exist yet — Gallery runs in empty-state mode.
    return [];
  }

  const IMAGE_EXTS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
  ]);

  return entries
    .filter((e) => e.isFile && IMAGE_EXTS.has(extOf(e.name).toLowerCase()))
    // Sort by filename for deterministic rotation order regardless of readdir
    // ordering, which is filesystem-dependent and not guaranteed stable.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => `/assets/gallery/${e.name}`);
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

// ADR-0002 module shape: default-export a Plugin object directly.
export default {
  run(ctx: RunContext): Result<GalleryState> {
    return {
      state: { src: pickPhoto(photos, ctx.t) },
      validity: rotationValidity(ctx.t),
      view: Gallery,
    };
  },
} satisfies Plugin<GalleryState>;
