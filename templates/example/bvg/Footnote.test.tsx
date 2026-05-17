/** @jsxImportSource hono/jsx */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Footnote from "./Footnote.tsx";
import type { ClipSummary } from "./board_assembler.ts";

function render(summary: ClipSummary | null | undefined) {
  // deno-lint-ignore no-explicit-any
  return renderToString(<Footnote clipSummary={summary} /> as any);
}

Deno.test("Footnote renders nothing when clipSummary is null", () => {
  assertEquals(render(null), "");
});

Deno.test("Footnote renders nothing when clipSummary is undefined", () => {
  assertEquals(render(undefined), "");
});

Deno.test("Footnote renders nothing when every icon has count 0", () => {
  const summary: ClipSummary = {
    perIcon: [
      { icon: "A", label: "Office", count: 0, nextLeaveBys: [] },
    ],
  };
  assertEquals(render(summary), "");
});

Deno.test("Footnote renders single-icon summary with leave-by HH:MMs", () => {
  const summary: ClipSummary = {
    perIcon: [
      {
        icon: "A",
        label: "Office",
        count: 3,
        nextLeaveBys: [
          new Date("2025-11-10T09:37:00+01:00"), // 09:37 Berlin → not, that's 08:37Z. Use Berlin display.
          new Date("2025-11-10T09:44:00+01:00"),
        ],
      },
    ],
  };
  const html = render(summary);
  assertStringIncludes(html, "+3 მოგვიანებით");
  assertStringIncludes(html, "A:");
  // Leave-bys formatted as HH:MM Berlin time (08:37Z → 09:37 Berlin in November, UTC+1).
  assertStringIncludes(html, "09:37");
  assertStringIncludes(html, "09:44");
  // Class hooks present.
  assertStringIncludes(html, "footnote");
});

Deno.test("Footnote renders multi-icon summary with all icons", () => {
  const summary: ClipSummary = {
    perIcon: [
      {
        icon: "A",
        label: "Office",
        count: 2,
        nextLeaveBys: [
          new Date("2025-11-10T09:37:00+01:00"),
          new Date("2025-11-10T09:44:00+01:00"),
        ],
      },
      {
        icon: "B",
        label: "Studio",
        count: 1,
        nextLeaveBys: [new Date("2025-11-10T09:39:00+01:00")],
      },
    ],
  };
  const html = render(summary);
  // Total dropped = 2 + 1 = 3.
  assertStringIncludes(html, "+3 მოგვიანებით");
  assertStringIncludes(html, "A:");
  assertStringIncludes(html, "B:");
  assertStringIncludes(html, "09:37");
  assertStringIncludes(html, "09:44");
  assertStringIncludes(html, "09:39");
  // Two chunks rendered.
  const chunks = html.match(/footnote__chunk/g);
  assert(chunks && chunks.length >= 2);
});
