/** @jsxImportSource hono/jsx */
import { assert, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { Layout } from "./Layout.tsx";
import { Content } from "./Content.tsx";
import { Grid } from "./Grid.tsx";
import { Flex } from "./Flex.tsx";
import { Columns } from "./Columns.tsx";

Deno.test("Layout default has ds-layout, no bleed modifier, no inline padding", () => {
  const html = renderToString(<Layout>x</Layout>);

  assertStringIncludes(html, `class="ds-layout"`);
  assert(!html.includes("ds-layout--bleed"));
  assert(!/style="[^"]*padding/.test(html), "padding comes from CSS class, not inline");
});

Deno.test("Layout bleed adds the modifier class", () => {
  const html = renderToString(<Layout bleed>x</Layout>);

  assertStringIncludes(html, "ds-layout");
  assertStringIncludes(html, "ds-layout--bleed");
});

Deno.test("Content renders with ds-content classname", () => {
  const html = renderToString(<Content>x</Content>);

  assertStringIncludes(html, `class="ds-content"`);
});

Deno.test("Grid cols as number emits repeat() in inline style", () => {
  const html = renderToString(<Grid cols={3} />);

  assertStringIncludes(html, `class="ds-grid"`);
  assertStringIncludes(html, "grid-template-columns:repeat(3, 1fr)");
});

Deno.test("Grid cols as string is used verbatim", () => {
  const html = renderToString(<Grid cols="72rem 1fr" gap="6.4rem" />);

  assertStringIncludes(html, "grid-template-columns:72rem 1fr");
  assertStringIncludes(html, "gap:6.4rem");
});

Deno.test("Grid without props omits inline style", () => {
  const html = renderToString(<Grid>x</Grid>);

  assert(!/style=/.test(html), "no inline style when no variants are set");
});

Deno.test("Flex direction, gap, align, justify, wrap all surface as expected", () => {
  const html = renderToString(
    <Flex direction="col" gap="1rem" align="center" justify="space-between" wrap>x</Flex>,
  );

  assertStringIncludes(html, "ds-flex");
  assertStringIncludes(html, "ds-flex--col");
  assertStringIncludes(html, "ds-flex--wrap");
  assertStringIncludes(html, "gap:1rem");
  assertStringIncludes(html, "align-items:center");
  assertStringIncludes(html, "justify-content:space-between");
});

Deno.test("Flex default direction is row, no wrap modifier", () => {
  const html = renderToString(<Flex>x</Flex>);

  assertStringIncludes(html, "ds-flex--row");
  assert(!html.includes("ds-flex--wrap"));
});

Deno.test("Columns count={4} emits column-count:4 inline", () => {
  const html = renderToString(<Columns count={4} gap="3.2rem" />);

  assertStringIncludes(html, `class="ds-columns"`);
  assertStringIncludes(html, "column-count:4");
  assertStringIncludes(html, "column-gap:3.2rem");
});

Deno.test("Columns defaults count to 2", () => {
  const html = renderToString(<Columns>x</Columns>);

  assertStringIncludes(html, "column-count:2");
});
