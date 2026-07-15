/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Sleep from "./Sleep.tsx";

function render() {
  // deno-lint-ignore no-explicit-any
  return renderToString(<Sleep /> as any);
}

Deno.test("Sleep renders a black background", () => {
  const html = render();
  assertStringIncludes(html, "background:#000");
});

Deno.test("Sleep renders the sleeping emoji", () => {
  const html = render();
  assertStringIncludes(html, "😴");
});

Deno.test("Sleep renders an html/head/body skeleton", () => {
  const html = render();
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "<head>");
  assertStringIncludes(html, "<body>");
});

Deno.test("Sleep is edge-to-edge with no margin/padding", () => {
  const html = render();
  assertStringIncludes(html, "margin:0");
  assertStringIncludes(html, "padding:0");
});

Deno.test("Sleep centers the emoji horizontally and vertically", () => {
  const html = render();
  assertStringIncludes(html, "display:flex");
  assertStringIncludes(html, "justify-content:center");
  assertStringIncludes(html, "align-items:center");
});

Deno.test("Sleep has a large emoji size", () => {
  const html = render();
  assertStringIncludes(html, "font-size");
  // Should be a large size (around 200px as specified)
  const sizeMatch = html.match(/font-size:(\d+)px/);
  assertEquals(sizeMatch !== null, true);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1], 10);
    assertEquals(size >= 150, true); // At least 150px
  }
});
