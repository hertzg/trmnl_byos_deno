/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import EmptyFrame from "./EmptyFrame.tsx";
import type { Board } from "./board_assembler.ts";

function renderEmpty(board: Board, now: Date) {
  // deno-lint-ignore no-explicit-any
  return renderToString(<EmptyFrame board={board} now={now} /> as any);
}

Deno.test("EmptyFrame for noScheduleApplicable shows the next-anchor hint", () => {
  // Mon 2025-11-17 09:30 Berlin = 08:30Z (CET, no DST).
  const now = new Date("2025-11-15T11:00:00Z");
  const board: Board = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: now,
    windows: [],
    nextAnchor: {
      arriveByDate: new Date("2025-11-17T08:30:00.000Z"),
      preferenceKey: "office",
      preferenceLabel: "Office",
      preferenceIcon: "A",
    },
  };
  const html = renderEmpty(board, now);
  assertStringIncludes(html, "ცარიელია");
  assertStringIncludes(html, "შემდეგი:");
  // ორშ (Monday abbrev in Georgian) 09:30 Berlin
  assertStringIncludes(html, "ორშ");
  assertStringIncludes(html, "09:30");
  assertStringIncludes(html, "A");
  assertStringIncludes(html, "Office");
});

Deno.test("EmptyFrame for noScheduleApplicable without nextAnchor omits the hint", () => {
  // Defensive — no preferences configured at all → no anchor to surface.
  const now = new Date("2025-11-15T11:00:00Z");
  const board: Board = {
    rows: [],
    emptyReason: "noScheduleApplicable",
    fetchedAt: now,
    windows: [],
  };
  const html = renderEmpty(board, now);
  assertStringIncludes(html, "ცარიელია");
  // No "შემდეგი:" hint when there's no anchor.
  assertEquals(html.includes("შემდეგი:"), false);
});

Deno.test("EmptyFrame for feedUnreachable shows age in minutes since lastSuccessfulFetchAt", () => {
  // 7 minutes between last success and now.
  const lastSuccess = new Date("2025-11-10T06:00:00Z");
  const now = new Date("2025-11-10T06:07:30Z");
  const board: Board = {
    rows: [],
    emptyReason: "feedUnreachable",
    fetchedAt: now,
    windows: [],
    lastSuccessfulFetchAt: lastSuccess,
  };
  const html = renderEmpty(board, now);
  assertStringIncludes(html, "მონაცემები მიუწვდომელია");
  assertStringIncludes(html, "7 წთ-ის წინანდელი");
  assertStringIncludes(html, "ვცდი თავიდან");
});

Deno.test("EmptyFrame for feedUnreachable with null cache shows '0 m old'", () => {
  const now = new Date("2025-11-10T06:00:00Z");
  const board: Board = {
    rows: [],
    emptyReason: "feedUnreachable",
    fetchedAt: now,
    windows: [],
    lastSuccessfulFetchAt: null,
  };
  const html = renderEmpty(board, now);
  assertStringIncludes(html, "მონაცემები მიუწვდომელია");
  assertStringIncludes(html, "0 წთ-ის წინანდელი");
});

Deno.test("EmptyFrame returns nothing when emptyReason is 'none'", () => {
  const now = new Date("2025-11-10T06:00:00Z");
  const board: Board = {
    rows: [],
    emptyReason: "none",
    fetchedAt: now,
    windows: [],
  };
  const html = renderEmpty(board, now);
  // Whatever is rendered must not contain either empty-state title.
  assertEquals(html.includes("ცარიელია"), false);
  assertEquals(html.includes("მონაცემები მიუწვდომელია"), false);
});
