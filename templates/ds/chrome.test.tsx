/** @jsxImportSource hono/jsx */
import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import { StatusBar } from "./StatusBar.tsx";
import { BatteryIndicator } from "./BatteryIndicator.tsx";
import { EmptyState } from "./EmptyState.tsx";

Deno.test("StatusBar defaults to a <footer> with the bottom modifier", () => {
  const html = renderToString(<StatusBar>hello</StatusBar>);

  assertMatch(html, /^<footer[^>]*>/);
  assertStringIncludes(html, "ds-status-bar");
  assertStringIncludes(html, "ds-status-bar--bottom");
  assertStringIncludes(html, "hello");
});

Deno.test('StatusBar with position="top" renders a <header> with the top modifier', () => {
  const html = renderToString(<StatusBar position="top">hi</StatusBar>);

  assertMatch(html, /^<header[^>]*>/);
  assertStringIncludes(html, "ds-status-bar--top");
  assert(!html.includes("ds-status-bar--bottom"));
});

Deno.test("BatteryIndicator returns null when value is null", () => {
  const html = renderToString(<BatteryIndicator value={null} />);

  assertEquals(html, "");
});

Deno.test("BatteryIndicator returns null when value is undefined", () => {
  const html = renderToString(<BatteryIndicator value={undefined} />);

  assertEquals(html, "");
});

Deno.test("BatteryIndicator renders shell, fill, and percent when value is a number", () => {
  const html = renderToString(<BatteryIndicator value={42} />);

  assertStringIncludes(html, "ds-battery");
  assertStringIncludes(html, "ds-battery__shell");
  assertStringIncludes(html, "ds-battery__fill");
  assertStringIncludes(html, "ds-battery__pct");
  assertStringIncludes(html, "42%");
  assertStringIncludes(html, "width: 42%");
});

Deno.test("BatteryIndicator exposes voltage via the title attribute", () => {
  const html = renderToString(<BatteryIndicator value={80} voltage={3.81} />);

  assertStringIncludes(html, 'title="3.81 V"');
});

Deno.test("EmptyState renders both big and sub when both are passed", () => {
  const html = renderToString(<EmptyState big="—" sub="no data" />);

  assertStringIncludes(html, "ds-empty-state");
  assertStringIncludes(html, "ds-empty-state__big");
  assertStringIncludes(html, "ds-empty-state__sub");
  assertStringIncludes(html, "—");
  assertStringIncludes(html, "no data");
});

Deno.test("EmptyState omits the sub div when sub is undefined", () => {
  const html = renderToString(<EmptyState big="—" />);

  assertStringIncludes(html, "ds-empty-state__big");
  assert(!html.includes("ds-empty-state__sub"));
});
