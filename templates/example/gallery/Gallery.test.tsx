/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Gallery from "./Gallery.tsx";

function render(src: string | null) {
  // deno-lint-ignore no-explicit-any
  return renderToString(<Gallery src={src} /> as any);
}

Deno.test("Gallery with a src renders an edge-to-edge img", () => {
  const html = render("/assets/gallery/sunset.jpg");
  assertStringIncludes(html, '<img src="/assets/gallery/sunset.jpg"');
  // Inline style is present and carries the edge-to-edge rules.
  assertStringIncludes(html, "object-fit:cover");
  assertStringIncludes(html, "margin:0");
});

Deno.test("Gallery with a src does not render DS chrome", () => {
  const html = render("/assets/gallery/sunset.jpg");
  // The DS Layout / StatusBar etc. must be absent — bare full-bleed document.
  assertEquals(html.includes("ds-layout"), false);
  assertEquals(html.includes("ds-status-bar"), false);
});

Deno.test("Gallery with src=null renders the EmptyState", () => {
  const html = render(null);
  assertStringIncludes(html, "ds-empty-state");
  assertStringIncludes(html, "No photos");
  assertStringIncludes(html, "templates/example/assets/gallery/");
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
