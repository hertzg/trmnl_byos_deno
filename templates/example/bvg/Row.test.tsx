/** @jsxImportSource hono/jsx */
import { assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Row from "./Row.tsx";
import type { Row as RowData } from "./journey_classifier.ts";

const ROW: RowData = {
  kind: "row",
  leaveByDate: new Date("2025-11-10T07:52:00Z"), // 08:52 Berlin
  arriveByDate: new Date("2025-11-10T08:16:00Z"), // 09:16 Berlin
  durationMinutes: 24,
  originLabel: "Hbf",
  destinationLabel: "Alex",
  preferenceKey: "office",
  preferenceLabel: "Office",
  preferenceIcon: "A",
  legs: [
    {
      kind: "transit",
      origin: { hafasStopId: "", displayName: "" },
      destination: { hafasStopId: "", displayName: "" },
      departure: new Date("2025-11-10T08:00:00Z"),
      arrival: new Date("2025-11-10T08:12:00Z"),
      line: { name: "S5", product: "suburban" },
      direction: "Strausberg",
    },
  ],
};

Deno.test("Row renders icon, leave-by, captions, pictogram, arrive-by, duration", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={ROW} /> as any);
  assertStringIncludes(html, "08:52"); // leave-by
  assertStringIncludes(html, "09:16"); // arrive-by
  assertStringIncludes(html, "leave Hbf");
  assertStringIncludes(html, "at Alex · Office");
  assertStringIncludes(html, "24"); // duration minutes
  assertStringIncludes(html, "A"); // preferenceIcon
  assertStringIncludes(html, "S5"); // pictogram
});
