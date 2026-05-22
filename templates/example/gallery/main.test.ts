import { assertEquals } from "@std/assert";
import GalleryPlugin from "./main.ts";
import Gallery from "./Gallery.tsx";
import type { RunContext } from "../../../src/plugin/plugin.ts";

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

// In this worktree, `templates/example/assets/gallery/` does not exist yet, so
// the discovered photo list is empty and `pickPhoto` returns null.  The
// non-empty rotation path (correct index selection, modulo wraparound) is fully
// exercised by rotation.test.ts with fabricated inputs — testing it again here
// would require shipping real image files or mocking module-load-time I/O,
// neither of which is warranted.
Deno.test("GalleryPlugin.run state.src is null when the gallery directory is absent", async () => {
  const result = await GalleryPlugin.run(makeCtx(0));
  assertEquals(result.state.src, null);
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
