import { assertEquals } from "@std/assert";
import { spy } from "@std/testing/mock";
import { createSlot, type SlotEntry } from "./slot.ts";
import type { Bundle } from "../plugin/bundle.ts";

const zone = "Europe/Berlin";
const fixedNow = () => Temporal.ZonedDateTime.from(`2026-05-17T12:00[${zone}]`);

function makeBundle(validity: Temporal.Duration): Bundle {
  return {
    result: {
      state: { ok: true },
      validity,
      view: () => "<p>x</p>",
    },
    assets: {},
  };
}

function makeEntry(overrides: Partial<SlotEntry> = {}): SlotEntry {
  const bundle = overrides.bundle ?? makeBundle(Temporal.Duration.from({ minutes: 5 }));
  const identity = overrides.identity ?? "id-1";
  return {
    identity,
    bundle,
    cachedAt: overrides.cachedAt ?? fixedNow(),
    image: overrides.image ?? Promise.resolve(new Uint8Array([1, 2, 3])),
  };
}

Deno.test("display() returns null when the slot is empty", () => {
  const slot = createSlot({ now: fixedNow });

  assertEquals(slot.display(), null);
});

Deno.test("image() returns null when the slot is empty, for any id", async () => {
  const slot = createSlot({ now: fixedNow });

  assertEquals(await slot.image("anything"), null);
});

Deno.test("after put(), display() returns the entry's identity and remaining validity", () => {
  const slot = createSlot({ now: fixedNow });
  const entry = makeEntry({
    identity: "abc123",
    bundle: makeBundle(Temporal.Duration.from({ minutes: 5 })),
  });
  slot.put(entry);

  const display = slot.display();

  assertEquals(display?.identity, "abc123");
  assertEquals(display?.refreshIn.total({ unit: "seconds" }), 300);
});

Deno.test("display() returns null after the entry's validity has elapsed", () => {
  let clock = Temporal.ZonedDateTime.from(`2026-05-17T12:00[${zone}]`);
  const slot = createSlot({ now: () => clock });
  slot.put(makeEntry({
    bundle: makeBundle(Temporal.Duration.from({ minutes: 5 })),
    cachedAt: clock,
  }));

  clock = clock.add(Temporal.Duration.from({ minutes: 5 }));

  assertEquals(slot.display(), null);
});

Deno.test("image(id) returns the bytes when id matches the entry's identity", async () => {
  const slot = createSlot({ now: fixedNow });
  const bytes = new Uint8Array([9, 8, 7]);
  slot.put(makeEntry({ identity: "abc123", image: Promise.resolve(bytes) }));

  assertEquals(await slot.image("abc123"), bytes);
});

Deno.test("image(id) returns null when id does not match the entry's identity", async () => {
  const slot = createSlot({ now: fixedNow });
  slot.put(makeEntry({ identity: "abc123" }));

  assertEquals(await slot.image("different"), null);
});

Deno.test("image(id) returns null once the entry's validity has elapsed, even on identity match", async () => {
  let clock = Temporal.ZonedDateTime.from(`2026-05-17T12:00[${zone}]`);
  const slot = createSlot({ now: () => clock });
  slot.put(makeEntry({
    identity: "abc123",
    bundle: makeBundle(Temporal.Duration.from({ minutes: 5 })),
    cachedAt: clock,
  }));

  clock = clock.add(Temporal.Duration.from({ minutes: 5 }));

  assertEquals(await slot.image("abc123"), null);
});

Deno.test("clear() returns the slot to empty (display and image both null again)", async () => {
  const slot = createSlot({ now: fixedNow });
  slot.put(makeEntry({ identity: "abc123" }));

  slot.clear();

  assertEquals(slot.display(), null);
  assertEquals(await slot.image("abc123"), null);
});

Deno.test("display() surfaces the entry's cachedAt unchanged", () => {
  const slot = createSlot({ now: fixedNow });
  const cachedAt = fixedNow().subtract(Temporal.Duration.from({ hours: 1 }));
  slot.put(makeEntry({
    cachedAt,
    bundle: makeBundle(Temporal.Duration.from({ hours: 2 })),
  }));

  const display = slot.display();

  assertEquals(display?.cachedAt.toString(), cachedAt.toString());
});

Deno.test("multiple image(id) calls share the stored promise (no re-render)", async () => {
  const slot = createSlot({ now: fixedNow });
  const bytes = new Uint8Array([1, 2, 3]);
  const rasterize = spy(() => Promise.resolve(bytes));
  // The Conductor would construct this promise once via the rasterizer; Slot
  // must hand it back as-is across calls and never invoke the rasterizer
  // itself.
  const imagePromise = rasterize();
  slot.put(makeEntry({ identity: "abc123", image: imagePromise }));

  const a = await slot.image("abc123");
  const b = await slot.image("abc123");
  const c = await slot.image("abc123");

  assertEquals(a, bytes);
  assertEquals(b, bytes);
  assertEquals(c, bytes);
  // Single invocation by the test (the put()); Slot never calls rasterize.
  assertEquals(rasterize.calls.length, 1);
});
