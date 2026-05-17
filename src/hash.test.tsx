/** @jsxImportSource hono/jsx */
import { assertEquals, assertMatch } from "@std/assert";
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

Deno.test("hashBundle returns a 16-char lowercase hex string", async () => {
  const bundle = bundleWith(
    { greeting: "hi" },
    (s) => <p>{(s as { greeting: string }).greeting}</p>,
  );

  const hash = await hashBundle(bundle);

  assertEquals(hash.length, 16);
  assertMatch(hash, /^[0-9a-f]{16}$/);
});
