import { renderToString } from "hono/jsx/dom/server";
import { encodeHex } from "@std/encoding/hex";
import type { Bundle } from "./plugin/bundle.ts";

// Hash choice + truncation length are encapsulated here so they can change
// without rippling through callers. Device-side SPIFFS cache handles >=16
// chars comfortably (resolved on PR #34).
const LENGTH = 16;

export async function hashBundle(bundle: Bundle): Promise<string> {
  const html = renderHtml(bundle);
  const payload = concatHtmlAndAssets(html, bundle.assets);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return encodeHex(new Uint8Array(digest)).slice(0, LENGTH);
}

function renderHtml(bundle: Bundle): string {
  const jsx = bundle.result.view(bundle.result.state) as Parameters<typeof renderToString>[0];
  return renderToString(jsx);
}

function concatHtmlAndAssets(
  html: string,
  assets: Record<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
  const htmlBytes = new TextEncoder().encode(html);
  const sortedKeys = [...Object.keys(assets)].sort();
  let totalLength = htmlBytes.length;
  for (const key of sortedKeys) totalLength += assets[key].length;
  const out = new Uint8Array(new ArrayBuffer(totalLength));
  out.set(htmlBytes, 0);
  let offset = htmlBytes.length;
  for (const key of sortedKeys) {
    out.set(assets[key], offset);
    offset += assets[key].length;
  }
  return out;
}
