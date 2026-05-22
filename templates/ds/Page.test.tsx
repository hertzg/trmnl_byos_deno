/** @jsxImportSource hono/jsx */
import { assert, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { Page } from "./Page.tsx";

Deno.test("Page renders the html/head/body skeleton with the title", () => {
  const html = renderToString(<Page title="trmnl-byos-deno">x</Page>);

  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "<head>");
  assertStringIncludes(html, "<body>x</body>");
  assertStringIncludes(html, "<title>trmnl-byos-deno</title>");
});

Deno.test("Page emits head in order: meta charset, title, Styles, plugin link", () => {
  const html = renderToString(
    <Page title="t" stylesheet="/assets/style.css">x</Page>,
  );

  const meta = html.indexOf("<meta");
  const title = html.indexOf("<title>");
  const styles = html.indexOf("<style");
  const link = html.indexOf("<link");

  assert(meta !== -1 && title !== -1 && styles !== -1 && link !== -1);
  assert(meta < title, "<meta charset> must precede <title>");
  assert(title < styles, "<title> must precede the <Styles> <style>");
  assert(
    styles < link,
    "<Styles> must precede the plugin stylesheet so overrides win by source order",
  );
});

Deno.test("Page omits the plugin <link> when stylesheet is not given", () => {
  const html = renderToString(<Page title="t">x</Page>);

  assert(
    !/<link\b/.test(html),
    "no plugin stylesheet link when stylesheet prop is absent",
  );
});

Deno.test("Page sets lang on <html> when the lang prop is given", () => {
  const html = renderToString(<Page title="t" lang="en">x</Page>);

  assertStringIncludes(html, `<html lang="en">`);
});

Deno.test("Page omits the lang attribute when no lang prop is given", () => {
  const html = renderToString(<Page title="t">x</Page>);

  assert(!/<html[^>]*\blang=/.test(html), "no lang attribute when lang is omitted");
});
