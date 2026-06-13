import type { Plugin, Result, RunContext } from "../../../src/plugin/plugin.ts";
import Gallery, { type GalleryState } from "./Gallery.tsx";
import { pickPhoto, rotationValidity } from "./rotation.ts";

// The mounted drop-folder the Gallery scans, relative to the process cwd where
// the `config/` volume is mounted (ADR-0010). The path mirrors the plugin tree,
// so `config/plugins/gallery/` plainly belongs to this leaf. The files inside
// are served back under `GALLERY_ASSET_PREFIX` — `src/main.ts` wires the same
// dir + prefix as an extra asset root on the PluginManager so the bytes the
// `<img src>` points at are actually reachable. Keep the two in sync.
export const GALLERY_IMAGES_DIR = "config/plugins/gallery/images";
export const GALLERY_ASSET_PREFIX = "/assets/gallery/";

// The set of photos is stable for the lifetime of the process — it reflects the
// files on disk at startup, not at call time. Discovery at module-load keeps
// `run` a pure function of `ctx.t` and avoids redundant filesystem access on
// every poll. A photo dropped into the folder appears after the next restart —
// matching the serving side, which also snapshots the folder once at startup.
const photos = discoverPhotos();

/**
 * Scan the gallery drop-folder and return sorted, URL-path-mapped entries.
 * Returns `[]` if the directory is absent (Gallery then runs in empty-state
 * mode) or holds no image files. `dir` is injectable for testing; production
 * uses the mounted {@link GALLERY_IMAGES_DIR}.
 */
export function discoverPhotos(dir: string | URL = GALLERY_IMAGES_DIR): string[] {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch {
    // Directory does not exist — Gallery runs in empty-state mode.
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
    .map((e) => `${GALLERY_ASSET_PREFIX}${e.name}`);
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
