/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import CancelStrip from "./CancelStrip.tsx";
import type { CancellationStrip } from "./journey_classifier.ts";

const BASE: CancellationStrip = {
  kind: "cancellationStrip",
  leaveByDate: new Date("2025-11-10T07:52:00Z"),
  preferenceKey: "office",
  preferenceLabel: "Office",
  preferenceIcon: "A",
  count: 1,
};

Deno.test("CancelStrip renders icon and 'გაუქმდა' for count: 1", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<CancelStrip strip={BASE} /> as any);
  assertStringIncludes(html, "A");
  assertStringIncludes(html, "გაუქმდა");
  // No pluralised "N მგზავრობა" form leaks in for count 1.
  assertEquals(html.includes("მგზავრობა"), false);
  // No pictogram artefact (line shorthand) and no times.
  assertEquals(html.includes("S5"), false);
  assertEquals(html.includes("07:52"), false);
  assertEquals(html.includes("08:52"), false);
});

Deno.test("CancelStrip renders 'გაუქმდა N მგზავრობა' for count > 1", () => {
  const strip: CancellationStrip = { ...BASE, count: 3 };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<CancelStrip strip={strip} /> as any);
  assertStringIncludes(html, "გაუქმდა 3 მგზავრობა");
});

Deno.test("CancelStrip uses the cancel-strip class hook (no new CSS in slice 7)", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<CancelStrip strip={BASE} /> as any);
  assertStringIncludes(html, "cancel-strip");
});
