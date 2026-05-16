import { assertEquals, assertNotEquals } from "@std/assert";
import { identityFor } from "./identity.ts";

Deno.test("identityFor returns a 16-char hex string, deterministic per input, distinct across inputs", async () => {
  const a1 = await identityFor("<p>hello</p>");
  const a2 = await identityFor("<p>hello</p>");
  const b = await identityFor("<p>world</p>");

  assertEquals(a1.length, 16);
  assertEquals(a1, a2);
  assertEquals(/^[0-9a-f]{16}$/.test(a1), true);
  assertNotEquals(a1, b);
});
