import { renderToString } from "hono/jsx/dom/server";
import { encodeHex } from "@std/encoding/hex";
import type { Bundle } from "./plugin/bundle.ts";

// Device-side SPIFFS cache handles >=16 chars comfortably (PR #34).
const LENGTH = 16;

export async function hashBundle(bundle: Bundle): Promise<string> {
  const html = renderHtml(bundle);
  const payload = concatHtmlAndAssets(html, bundle.assets);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return encodeHex(new Uint8Array(digest)).slice(0, LENGTH);
}

// Digest a Plugin-asserted content identity (Result `hints.identity`) into
// the same 16-hex shape as hashBundle, so the Device-facing filename looks
// identical whichever path derived it.
export async function hashIdentity(identity: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return encodeHex(new Uint8Array(digest)).slice(0, LENGTH);
}

function renderHtml(bundle: Bundle): string {
  const jsx = bundle.result.view(bundle.result.state) as Parameters<typeof renderToString>[0];
  return renderToString(jsx);
}

// Each asset is serialised as `utf8(key) + 0x00 + bytes + 0x00`, so two
// assets with identical bytes but different keys hash differently. Keys are
// processed in sorted order so insertion order doesn't affect the digest.
function concatHtmlAndAssets(
  html: string,
  assets: Record<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const htmlBytes = encoder.encode(html);
  const sortedKeys = [...Object.keys(assets)].sort();
  const keyBytesByKey = new Map<string, Uint8Array>();
  for (const key of sortedKeys) keyBytesByKey.set(key, encoder.encode(key));

  let totalLength = htmlBytes.length;
  for (const key of sortedKeys) {
    totalLength += keyBytesByKey.get(key)!.length + 1 + assets[key].length + 1;
  }

  const out = new Uint8Array(new ArrayBuffer(totalLength));
  out.set(htmlBytes, 0);
  let offset = htmlBytes.length;
  for (const key of sortedKeys) {
    const keyBytes = keyBytesByKey.get(key)!;
    out.set(keyBytes, offset);
    offset += keyBytes.length;
    offset += 1; // 0x00 separator between key and bytes
    out.set(assets[key], offset);
    offset += assets[key].length;
    offset += 1; // 0x00 terminator between entries
  }
  return out;
}
