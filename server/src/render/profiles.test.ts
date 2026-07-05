import { assertEquals } from "@std/assert";
import { getProfile, profileIds } from "./profiles.ts";

Deno.test("getProfile returns the TRMNL X entry by id", () => {
  const profile = getProfile("trmnl-x");
  assertEquals(profile?.width, 1872);
  assertEquals(profile?.height, 1404);
  assertEquals(profile?.bitDepth, 4);
  assertEquals(profile?.dither, "floyd-steinberg");
});

Deno.test("getProfile returns undefined for an unknown id", () => {
  assertEquals(getProfile("not-a-device"), undefined);
});

Deno.test("profileIds lists the registered devices, including trmnl-x", () => {
  const ids = profileIds();
  assertEquals(ids.includes("trmnl-x"), true);
});
