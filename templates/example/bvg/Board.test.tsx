/** @jsxImportSource hono/jsx */
import { assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Board from "./Board.tsx";
import type { Board as BoardData } from "./board_assembler.ts";
import type { CancellationStrip, Row } from "./journey_classifier.ts";

const ROW: Row = {
  kind: "row",
  leaveByDate: new Date("2025-11-10T07:52:00Z"),
  plannedLeaveByDate: new Date("2025-11-10T07:52:00Z"),
  arriveByDate: new Date("2025-11-10T08:16:00Z"),
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
};

Deno.test("Board renders head and the row list", () => {
  const board: BoardData = {
    rows: [ROW],
    emptyReason: "none",
    fetchedAt: new Date("2025-11-10T07:00:00Z"),
    windows: [],
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  // Row content surfaces.
  assertStringIncludes(html, "S5");
  assertStringIncludes(html, "08:52");
});

Deno.test("Board renders both Row and CancellationStrip kinds, narrowing on `kind`", () => {
  const strip: CancellationStrip = {
    kind: "cancellationStrip",
    leaveByDate: new Date("2025-11-10T07:55:00Z"),
    preferenceKey: "office",
    preferenceLabel: "Office",
    preferenceIcon: "A",
    count: 2,
  };
  const board: BoardData = {
    rows: [ROW, strip],
    emptyReason: "none",
    fetchedAt: new Date("2025-11-10T07:00:00Z"),
    windows: [],
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  // Row content surfaces.
  assertStringIncludes(html, "S5");
  // Strip content surfaces with the pluralised caption.
  assertStringIncludes(html, "2 journeys cancelled");
  assertStringIncludes(html, "cancel-strip");
});

Deno.test("Board renders empty frame when no rows", () => {
  const board: BoardData = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: new Date("2025-11-10T07:00:00Z"),
    windows: [],
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  assertStringIncludes(html, "nothing to show right now");
});
