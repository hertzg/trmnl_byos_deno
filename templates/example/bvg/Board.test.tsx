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
  imminence: "future",
  graceExpiresAt: new Date("2025-11-10T07:57:00Z"),
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
  assertStringIncludes(html, "გაუქმდა 2 მგზავრობა");
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
  assertStringIncludes(html, "ცარიელია");
});

Deno.test("Board renders feedUnreachable empty frame with age sub-text", () => {
  const board: BoardData = {
    rows: [],
    emptyReason: "feedUnreachable",
    fetchedAt: new Date("2025-11-10T07:10:00Z"),
    windows: [],
    lastSuccessfulFetchAt: new Date("2025-11-10T07:00:00Z"),
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  assertStringIncludes(html, "მონაცემები მიუწვდომელია");
  assertStringIncludes(html, "10 წთ-ის წინანდელი");
});

Deno.test("Board renders footnote when clipSummary present", () => {
  const board: BoardData = {
    rows: [ROW],
    emptyReason: "none",
    fetchedAt: new Date("2025-11-10T07:00:00Z"),
    windows: [],
    clipSummary: {
      perIcon: [{
        icon: "A",
        label: "Office",
        count: 2,
        nextLeaveBys: [new Date("2025-11-10T08:37:00Z")],
      }],
    },
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  assertStringIncludes(html, "+2 მოგვიანებით");
  assertStringIncludes(html, "footnote");
});

Deno.test("Board omits footnote when clipSummary is null", () => {
  const board: BoardData = {
    rows: [ROW],
    emptyReason: "none",
    fetchedAt: new Date("2025-11-10T07:00:00Z"),
    windows: [],
    clipSummary: null,
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  if (html.includes("footnote")) {
    throw new Error(`expected no footnote, got: ${html}`);
  }
});

Deno.test("Board renders next-anchor hint inside the noScheduleApplicable frame", () => {
  const board: BoardData = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: new Date("2025-11-15T11:00:00Z"),
    windows: [],
    nextAnchor: {
      arriveByDate: new Date("2025-11-17T08:30:00.000Z"),
      preferenceKey: "office",
      preferenceLabel: "Office",
      preferenceIcon: "A",
    },
  };
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Board board={board} /> as any);
  assertStringIncludes(html, "ცარიელია");
  assertStringIncludes(html, "შემდეგი:");
  assertStringIncludes(html, "ორშ");
  assertStringIncludes(html, "09:30");
  assertStringIncludes(html, "Office");
});
