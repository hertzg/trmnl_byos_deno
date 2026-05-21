/** @jsxImportSource hono/jsx */
import { assert, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { Item } from "./Item.tsx";

Deno.test("Item always renders the meta slot, even when meta prop is undefined", () => {
  const html = renderToString(<Item content={<span>body</span>} />);

  assertStringIncludes(html, "ds-item__meta");
});

Deno.test("Item omits the icon slot when icon prop is undefined", () => {
  const html = renderToString(<Item meta={<span>M</span>} content={<span>C</span>} />);

  assert(
    !html.includes("ds-item__icon"),
    "icon slot div must not render when icon prop is missing",
  );
});

Deno.test("Item renders the icon slot when icon prop is provided", () => {
  const html = renderToString(
    <Item meta={<span>M</span>} icon={<span>I</span>} content={<span>C</span>} />,
  );

  assertStringIncludes(html, "ds-item__icon");
});

Deno.test("Item passes meta/content/icon JSX through verbatim", () => {
  const html = renderToString(
    <Item meta={<b>M</b>} icon={<i>I</i>} content={<span>C</span>} />,
  );

  assertStringIncludes(html, "<b>M</b>");
  assertStringIncludes(html, "<i>I</i>");
  assertStringIncludes(html, "<span>C</span>");
});

Deno.test("Item with emphasis=meta adds the modifier class", () => {
  const plain = renderToString(<Item meta={<span>M</span>} content={<span>C</span>} />);
  const emphasised = renderToString(
    <Item meta={<span>M</span>} content={<span>C</span>} emphasis="meta" />,
  );

  assert(
    !plain.includes("ds-item--meta-emphasis"),
    "plain Item must not carry --meta-emphasis",
  );
  assertStringIncludes(emphasised, "ds-item--meta-emphasis");
});
