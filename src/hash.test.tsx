/** @jsxImportSource hono/jsx */
import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { hashBundle } from "./hash.ts";
import type { Bundle } from "./plugin/bundle.ts";

function bundleWith(
  state: unknown,
  view: (s: unknown) => unknown,
  assets: Record<string, Uint8Array> = {},
): Bundle {
  return {
    result: {
      state,
      validity: Temporal.Duration.from({ minutes: 5 }),
      view,
    },
    assets,
  };
}

function helloView(state: unknown): unknown {
  return <p>{(state as { greeting: string }).greeting}</p>;
}

function staticView(_: unknown): unknown {
  return <p>same</p>;
}

Deno.test("hashBundle returns a 16-char lowercase hex string", async () => {
  const bundle = bundleWith({ greeting: "hi" }, helloView);

  const hash = await hashBundle(bundle);

  assertEquals(hash.length, 16);
  assertMatch(hash, /^[0-9a-f]{16}$/);
});

Deno.test("hashBundle is deterministic for identical bundle inputs", async () => {
  const a = bundleWith({ greeting: "hi" }, helloView);
  const b = bundleWith({ greeting: "hi" }, helloView);

  assertEquals(await hashBundle(a), await hashBundle(b));
});

Deno.test("hashBundle changes when the rendered HTML changes", async () => {
  const hi = bundleWith({ greeting: "hi" }, helloView);
  const ciao = bundleWith({ greeting: "ciao" }, helloView);

  assertNotEquals(await hashBundle(hi), await hashBundle(ciao));
});

Deno.test("hashBundle changes when an asset's bytes change", async () => {
  const stateless = { x: 1 };
  const original = bundleWith(stateless, staticView, {
    "/assets/a.bin": new Uint8Array([1, 2, 3]),
  });
  const edited = bundleWith(stateless, staticView, {
    "/assets/a.bin": new Uint8Array([1, 2, 4]),
  });

  assertNotEquals(await hashBundle(original), await hashBundle(edited));
});

Deno.test("hashBundle ignores the insertion order of asset keys (sorted internally)", async () => {
  const stateless = { x: 1 };
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([3, 4]);
  const ab = bundleWith(stateless, staticView, { "/assets/a": a, "/assets/b": b });
  const ba = bundleWith(stateless, staticView, { "/assets/b": b, "/assets/a": a });

  assertEquals(await hashBundle(ab), await hashBundle(ba));
});
