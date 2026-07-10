import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { hash } from "./hash.ts";

Deno.test("hash returns a 16-char lowercase hex string", async () => {
  const digest = await hash("hello");

  assertEquals(digest.length, 16);
  assertMatch(digest, /^[0-9a-f]{16}$/);
});

Deno.test("hash is deterministic for identical string input", async () => {
  assertEquals(await hash("same"), await hash("same"));
});

Deno.test("hash changes when the input string changes", async () => {
  assertNotEquals(await hash("a"), await hash("b"));
});

Deno.test("hash of a string equals hash of its UTF-8-encoded bytes", async () => {
  const text = "same bytes, different shape";

  assertEquals(await hash(text), await hash(new TextEncoder().encode(text)));
});

Deno.test("hash changes when the input bytes change", async () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 4]);

  assertNotEquals(await hash(a), await hash(b));
});
