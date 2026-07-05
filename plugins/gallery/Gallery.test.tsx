/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Gallery from "./Gallery.tsx";

function render(src: string | null, note?: string) {
  // deno-lint-ignore no-explicit-any
  return renderToString(<Gallery src={src} note={note} /> as any);
}

Deno.test("Gallery with a src renders an edge-to-edge, center-cropped img", () => {
  const html = render("https://cvws.icloud-content.com/signed/path");
  assertStringIncludes(html, '<img src="https://cvws.icloud-content.com/signed/path"');
  assertStringIncludes(html, "object-fit:cover");
  assertStringIncludes(html, "margin:0");
  assertStringIncludes(html, "background:#fff");
});

Deno.test("Gallery with a src does not render DS chrome", () => {
  const html = render("https://cvws.icloud-content.com/signed/path");
  // The DS Layout / StatusBar etc. must be absent — bare full-bleed document.
  assertEquals(html.includes("ds-layout"), false);
  assertEquals(html.includes("ds-status-bar"), false);
});

Deno.test("Gallery with src=null renders the EmptyState with the default note", () => {
  const html = render(null);
  assertStringIncludes(html, "ds-empty-state");
  assertStringIncludes(html, "No photo");
  assertStringIncludes(html, "The shared album is empty");
});

Deno.test("Gallery with src=null and a note renders the given note (e.g. a fetch failure)", () => {
  const html = render(null, "Album fetch failed: icloud webstream: HTTP 500");
  assertStringIncludes(html, "Album fetch failed: icloud webstream: HTTP 500");
});

Deno.test("Gallery with src=null renders via Page (has html/head/body skeleton)", () => {
  const html = render(null);
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "<head>");
  assertStringIncludes(html, "<body>");
});

Deno.test("Gallery with src=null does not render an img element", () => {
  const html = render(null);
  assertEquals(html.includes("<img"), false);
});
