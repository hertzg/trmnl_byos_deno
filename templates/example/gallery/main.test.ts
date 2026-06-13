import { assert, assertEquals } from "@std/assert";
import GalleryPlugin, { discoverPhotos } from "./main.ts";
import Gallery from "./Gallery.tsx";
import type { RunContext } from "../../../src/plugin/plugin.ts";

async function writeImagesDir(names: string[]): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "gallery-images-test-" });
  for (const name of names) await Deno.writeTextFile(`${dir}/${name}`, "x");
  return dir;
}

Deno.test("discoverPhotos maps image files in the drop-folder to /assets/gallery/<name>, sorted", async () => {
  const dir = await writeImagesDir(["b.jpg", "a.png", "c.webp"]);
  assertEquals(discoverPhotos(dir), [
    "/assets/gallery/a.png",
    "/assets/gallery/b.jpg",
    "/assets/gallery/c.webp",
  ]);
});

Deno.test("discoverPhotos ignores non-image files (e.g. .gitkeep, README)", async () => {
  const dir = await writeImagesDir([".gitkeep", "README.md", "ok.jpg"]);
  assertEquals(discoverPhotos(dir), ["/assets/gallery/ok.jpg"]);
});

Deno.test("discoverPhotos returns [] for an empty drop-folder", async () => {
  const dir = await writeImagesDir([]);
  assertEquals(discoverPhotos(dir), []);
});

Deno.test("discoverPhotos returns [] when the drop-folder is absent", () => {
  assertEquals(discoverPhotos("/no/such/gallery/dir"), []);
});

// Minimal RunContext sufficient for a synchronous, scrub-intent call.
function makeCtx(epochMs: number): RunContext {
  return {
    t: new Temporal.Instant(BigInt(epochMs) * 1_000_000n).toZonedDateTimeISO(
      "UTC",
    ),
    intent: "scrub",
    device: null,
  };
}

Deno.test("GalleryPlugin.run returns a Result whose view is the Gallery component", async () => {
  const result = await GalleryPlugin.run(makeCtx(0));
  assertEquals(result.view, Gallery);
});

Deno.test("GalleryPlugin.run validity is a Temporal.Duration (positive)", async () => {
  const result = await GalleryPlugin.run(makeCtx(0));
  assertEquals(result.validity instanceof Temporal.Duration, true);
  if (result.validity.total({ unit: "milliseconds" }) <= 0) {
    throw new Error("Expected a positive validity duration");
  }
});

// `run` closes over the module-load snapshot of the live, gitignored
// `config/plugins/gallery/images/` drop-folder, whose contents are
// machine-specific (empty on CI / a fresh checkout, populated on the
// operator's deployment). So this asserts only what holds regardless of those
// contents: `run` wired discovery → `pickPhoto`, picking one of the discovered
// photos, or null when there are none. The empty→null path is covered without
// this coupling by the `discoverPhotos returns []` tests above (temp dirs) and
// `pickPhoto: empty array → null` in rotation.test.ts; the non-empty rotation
// path (index selection, modulo wraparound) likewise lives in rotation.test.ts.
Deno.test("GalleryPlugin.run state.src is consistent with the discovered photos", async () => {
  const photos = discoverPhotos(); // same source run() snapshotted at module load
  const result = await GalleryPlugin.run(makeCtx(0));
  if (photos.length === 0) {
    assertEquals(result.state.src, null);
  } else {
    assert(photos.includes(result.state.src!)); // run picked one of the real photos
  }
});

Deno.test("GalleryPlugin.run is a pure function of ctx.t — same t yields same state", async () => {
  const ctx = makeCtx(42_000);
  const first = await GalleryPlugin.run(ctx);
  const second = await GalleryPlugin.run(ctx);
  assertEquals(first.state.src, second.state.src);
  assertEquals(
    first.validity.total({ unit: "milliseconds" }),
    second.validity.total({ unit: "milliseconds" }),
  );
});
