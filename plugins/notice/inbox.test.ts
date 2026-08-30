import { assertEquals } from "@std/assert";
import { createInbox } from "./inbox.ts";

// Temporal test helper
function at(spec: string): Temporal.Instant {
  return Temporal.Instant.from(spec);
}

Deno.test("live: returns notices in arrival order, oldest first", () => {
  // The inbox is a thread: the order things were added is the order they read.
  const inbox = createInbox();
  inbox.add({
    text: "first",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });
  inbox.add({
    text: "second",
    receivedAt: at("2026-08-30T12:05:00Z"),
    expiresAt: at("2026-08-30T12:20:00Z"),
  });

  const live = inbox.live(at("2026-08-30T12:06:00Z"));

  assertEquals(live.map((n) => n.text), ["first", "second"]);
});
