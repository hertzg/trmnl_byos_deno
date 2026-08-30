import { assertEquals } from "@std/assert";
import { identity } from "./device.ts";

const OPTIONS = {
  base: "http://localhost:3000",
  id: "AA:BB:CC:DD:EE:FF",
  token: "token-abc123",
  fw: "1.8.14",
} as const;

Deno.test("identity takes the panel size from the board", () => {
  const device = identity({ ...OPTIONS, board: "og" });
  assertEquals(device.width, 800);
  assertEquals(device.height, 480);
});

Deno.test("identity lets an explicit size override the board's panel", () => {
  const device = identity({ ...OPTIONS, board: "x", width: 640, height: 400 });
  assertEquals(device.width, 640);
  assertEquals(device.height, 400);
});

Deno.test("identity resolves the board name to its board", () => {
  assertEquals(identity({ ...OPTIONS, board: "x" }).board.model, "x");
  assertEquals(identity({ ...OPTIONS, board: "og" }).board.model, "og");
});

Deno.test("identity trims a trailing slash so request urls never double up", () => {
  const device = identity({ ...OPTIONS, base: "http://localhost:3000/", board: "x" });
  assertEquals(device.base, "http://localhost:3000");
});

Deno.test("identity trims every trailing slash, not just the last", () => {
  const device = identity({ ...OPTIONS, base: "http://localhost:3000///", board: "x" });
  assertEquals(device.base, "http://localhost:3000");
});
