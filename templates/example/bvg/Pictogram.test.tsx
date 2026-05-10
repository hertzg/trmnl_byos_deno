/** @jsxImportSource hono/jsx */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "hono/jsx/dom/server";
import Pictogram from "./Pictogram.tsx";
import type { Leg } from "./journey_client.ts";

function transit(name: string, product: string, dep: string, arr: string): Leg {
  return {
    kind: "transit",
    origin: { hafasStopId: "", displayName: "" },
    destination: { hafasStopId: "", displayName: "" },
    departure: new Date(dep),
    arrival: new Date(arr),
    line: { name, product },
    direction: "",
  };
}

function walk(durationMinutes: number): Leg {
  const dep = new Date("2025-11-10T08:00:00Z");
  const arr = new Date(dep.getTime() + durationMinutes * 60_000);
  return {
    kind: "walking",
    origin: { hafasStopId: "", displayName: "" },
    destination: { hafasStopId: "", displayName: "" },
    departure: dep,
    arrival: arr,
    durationMinutes,
  };
}

Deno.test("Pictogram renders walk · line → walk · line → walk", () => {
  const legs: Leg[] = [
    walk(8),
    transit("S5", "suburban", "2025-11-10T08:08:00Z", "2025-11-10T08:20:00Z"),
    walk(2),
    transit("U2", "subway", "2025-11-10T08:22:00Z", "2025-11-10T08:30:00Z"),
    walk(4),
  ];
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Pictogram legs={legs} /> as any);
  // Walk badges with minute counts.
  assertStringIncludes(html, "8");
  assertStringIncludes(html, "2");
  assertStringIncludes(html, "4");
  // Line badges.
  assertStringIncludes(html, "S5");
  assertStringIncludes(html, "U2");
  // Separators: walks → transits via "·", transits → transits via "→".
  assertStringIncludes(html, "·");
  assertStringIncludes(html, "→");
});

Deno.test("Pictogram renders walking-only journey as a single 🚶 N badge", () => {
  const legs: Leg[] = [walk(12)];
  // deno-lint-ignore no-explicit-any
  const html = renderToString(<Pictogram legs={legs} /> as any);
  assertStringIncludes(html, "12");
  // Walking-only: no arrows, no middots.
  assertEquals(html.includes("→"), false);
  assertEquals(html.includes("·"), false);
});
