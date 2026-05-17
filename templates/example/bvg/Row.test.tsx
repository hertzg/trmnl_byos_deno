/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Row from "./Row.tsx";
import type { Row as RowData } from "./journey_classifier.ts";

const BASE_LEAVE = new Date("2025-11-10T07:52:00Z"); // 08:52 Berlin

const ROW: RowData = {
  kind: "row",
  leaveByDate: BASE_LEAVE,
  plannedLeaveByDate: BASE_LEAVE,
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
      realtime: { delaySeconds: 0, cancelled: false, hasRealtime: false, remarks: [] },
    },
  ],
  alerts: [],
  imminence: "future",
  graceExpiresAt: new Date("2025-11-10T07:57:00Z"),
};

Deno.test("Row renders icon, leave-by, captions, pictogram, arrive-by, duration", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={ROW} /> as any);
  assertStringIncludes(html, "08:52"); // leave-by
  assertStringIncludes(html, "09:16"); // arrive-by
  assertStringIncludes(html, "Alex · Office");
  assertStringIncludes(html, "24"); // duration minutes
  assertStringIncludes(html, "A"); // preferenceIcon
  assertStringIncludes(html, "S5"); // pictogram
});

Deno.test("Row: empty alerts → no ⚠ pills and no 'იყო' caption", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={ROW} /> as any);
  assertEquals(html.includes("⚠"), false);
  assertEquals(html.includes("იყო "), false);
});

Deno.test("Row: renders ⚠ pills for each alert under leave-by", () => {
  const row: RowData = {
    ...ROW,
    alerts: [
      { kind: "delay", text: "+4წთ დაგვიანება" },
      { kind: "remark", text: "U2 lift OOS at Alex" },
    ],
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={row} /> as any);
  assertStringIncludes(html, "⚠");
  assertStringIncludes(html, "+4წთ დაგვიანება");
  assertStringIncludes(html, "U2 lift OOS at Alex");
});

Deno.test("Row: imminence=future does NOT render row--leave-now class or stamp", () => {
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={ROW} /> as any);
  assertEquals(html.includes("row--leave-now"), false);
  assertEquals(html.includes("ახლავე გადი"), false);
});

Deno.test("Row: imminence=leave-now renders row--leave-now class + 'ახლავე გადი' stamp", () => {
  const row: RowData = { ...ROW, imminence: "leave-now" };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={row} /> as any);
  assertStringIncludes(html, "row--leave-now");
  assertStringIncludes(html, "ახლავე გადი");
});

Deno.test("Row: renders 'იყო HH:MM' caption when planned ≠ effective leave-by", () => {
  // Effective shifted +4m past planned. Planned = 08:52 Berlin, effective = 08:56 Berlin.
  const row: RowData = {
    ...ROW,
    leaveByDate: new Date("2025-11-10T07:56:00Z"),
    plannedLeaveByDate: new Date("2025-11-10T07:52:00Z"),
    alerts: [{ kind: "delay", text: "+4წთ დაგვიანება" }],
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Row row={row} /> as any);
  assertStringIncludes(html, "08:56"); // current leave-by
  assertStringIncludes(html, "იყო 08:52"); // planned caption
});
