import { encodeHex } from "@std/encoding/hex";

// Device-side SPIFFS cache handles >=16 chars comfortably (PR #34).
const LENGTH = 16;

export async function hash(payload: string | BufferSource): Promise<string> {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return encodeHex(new Uint8Array(digest)).slice(0, LENGTH);
}
