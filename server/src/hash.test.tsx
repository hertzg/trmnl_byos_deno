/** @jsxImportSource hono/jsx */
import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { hashBundle } from "./hash.ts";
import type { Bundle } from "./plugin/bundle.ts";

function bundleWith(
  state: unknown,
  view: (s: unknown) => unknown,
  assets: Record<string, Uint8Array<ArrayBuffer>> = {},
  hints?: Record<string, unknown>,
): Bundle {
  return {
    result: {
      state,
      validity: Temporal.Duration.from({ minutes: 5 }),
      view,
      hints,
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

Deno.test("hashBundle changes when an asset key is renamed (bytes identical)", async () => {
  const stateless = { x: 1 };
  const bytes = new Uint8Array([1, 2, 3]);
  const atA = bundleWith(stateless, staticView, { "/assets/a": bytes });
  const atB = bundleWith(stateless, staticView, { "/assets/b": bytes });

  assertNotEquals(await hashBundle(atA), await hashBundle(atB));
});

Deno.test("hashBundle digests hints.identity instead of HTML+assets when it is a string", async () => {
  const withIdentity = bundleWith({ greeting: "hi" }, helloView, {
    "/assets/a.bin": new Uint8Array([1, 2, 3]),
  }, { identity: "photo:abc" });
  // Same identity string, but everything that would normally feed the hash
  // (state, view output, assets) differs — the hash must still match.
  const differentEverythingElse = bundleWith({ greeting: "ciao" }, staticView, {
    "/assets/b.bin": new Uint8Array([9, 9]),
  }, { identity: "photo:abc" });

  assertEquals(await hashBundle(withIdentity), await hashBundle(differentEverythingElse));
});

Deno.test("hashBundle changes when hints.identity changes, even if HTML+assets are identical", async () => {
  const a = bundleWith({ x: 1 }, staticView, {}, { identity: "photo:abc" });
  const b = bundleWith({ x: 1 }, staticView, {}, { identity: "photo:def" });

  assertNotEquals(await hashBundle(a), await hashBundle(b));
});

Deno.test("hashBundle falls back to HTML+assets when hints.identity is absent or non-string", async () => {
  const noHints = bundleWith({ greeting: "hi" }, helloView);
  const nonStringIdentity = bundleWith({ greeting: "hi" }, helloView, {}, {
    identity: 42,
  });

  assertEquals(await hashBundle(noHints), await hashBundle(nonStringIdentity));
});

Deno.test("hashBundle ignores hints.holdIdentity — only hints.identity affects the digest", async () => {
  const withHold = bundleWith({ greeting: "hi" }, helloView, {}, {
    holdIdentity: "photo:zzz",
  });
  const withoutHold = bundleWith({ greeting: "hi" }, helloView);

  assertEquals(await hashBundle(withHold), await hashBundle(withoutHold));
});
