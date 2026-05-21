/** @jsxImportSource hono/jsx */
import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { Styles } from "./Styles.tsx";

Deno.test("Styles renders a single <style> element", () => {
  const html = renderToString(<Styles />);

  assertMatch(html, /^<style[^>]*>[\s\S]*<\/style>$/);
  assertEquals(html.match(/<style[\s>]/g)?.length, 1);
  assertEquals(html.match(/<\/style>/g)?.length, 1);
  assert(
    !/&(?:lt|gt|amp|quot|#\d+);/.test(html),
    "Styles must not HTML-escape CSS text inside <style>",
  );
});

Deno.test("Styles inlines the rem anchor from base.css", () => {
  const html = renderToString(<Styles />);

  assertStringIncludes(html, "font-size: 10px");
});

Deno.test("Styles does not inline any @font-face declarations", () => {
  const html = renderToString(<Styles />);

  assert(
    !html.includes("@font-face"),
    "DS base.css must not ship @font-face — fonts stay plugin-controlled",
  );
});
