import { encodeHex } from "@std/encoding/hex";

// Hash choice + truncation length are encapsulated here so they can change
// without rippling through callers. Device-side SPIFFS cache handles ≥16
// chars comfortably (resolved thread on PR #34).
const LENGTH = 16;

export async function identityFor(html: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
  return encodeHex(new Uint8Array(digest)).slice(0, LENGTH);
}
