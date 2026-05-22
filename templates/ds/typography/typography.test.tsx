/** @jsxImportSource hono/jsx */
import { assert, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { Title } from "./Title.tsx";
import { Value } from "./Value.tsx";
import { Label } from "./Label.tsx";
import { Description } from "./Description.tsx";

Deno.test("Title renders ds-title and no --base modifier for default size", () => {
  const html = renderToString(<Title>hello</Title>);

  assertStringIncludes(html, "ds-title");
  assert(!html.includes("ds-title--base"), "default size should not add --base modifier");
});

Deno.test("Title size prop adds the matching modifier", () => {
  const html = renderToString(<Title size="large">hello</Title>);

  assertStringIncludes(html, "ds-title ds-title--large");
});

Deno.test("Value renders ds-value and supports tnums", () => {
  const plain = renderToString(<Value>42</Value>);
  const tnums = renderToString(<Value tnums>42</Value>);

  assertStringIncludes(plain, "ds-value");
  assert(!plain.includes("ds-value--tnums"), "plain Value must not carry --tnums");
  assertStringIncludes(tnums, "ds-value--tnums");
});

Deno.test("Value size reaches the framework's peta tier", () => {
  const html = renderToString(<Value size="peta">99</Value>);

  assertStringIncludes(html, "ds-value--peta");
});

Deno.test("Label renders ds-label and toggles --muted", () => {
  const plain = renderToString(<Label>WHEN</Label>);
  const muted = renderToString(<Label muted>WHEN</Label>);

  assertStringIncludes(plain, "ds-label");
  assert(!plain.includes("ds-label--muted"), "plain Label must not carry --muted");
  assertStringIncludes(muted, "ds-label--muted");
});

Deno.test("Description renders ds-description with size modifiers", () => {
  const base = renderToString(<Description>hi</Description>);
  const large = renderToString(<Description size="large">hi</Description>);

  assertStringIncludes(base, "ds-description");
  assert(!base.includes("ds-description--base"), "default size should not add --base modifier");
  assertStringIncludes(large, "ds-description--large");
});

Deno.test("Typography components render children verbatim", () => {
  assertStringIncludes(renderToString(<Title>hi</Title>), ">hi<");
  assertStringIncludes(renderToString(<Value>42</Value>), ">42<");
  assertStringIncludes(renderToString(<Label>WHEN</Label>), ">WHEN<");
  assertStringIncludes(renderToString(<Description>note</Description>), ">note<");
});
