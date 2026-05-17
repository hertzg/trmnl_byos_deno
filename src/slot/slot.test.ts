import { assertEquals } from "@std/assert";
import { createSlot } from "./slot.ts";

const zone = "Europe/Berlin";
const fixedNow = () => Temporal.ZonedDateTime.from(`2026-05-17T12:00[${zone}]`);

Deno.test("display() returns null when the slot is empty", () => {
  const slot = createSlot({ now: fixedNow });

  assertEquals(slot.display(), null);
});

Deno.test("image() returns null when the slot is empty, for any id", async () => {
  const slot = createSlot({ now: fixedNow });

  assertEquals(await slot.image("anything"), null);
});
