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

Deno.test("live: a notice at exactly its expiresAt is excluded", () => {
  // The boundary is exclusive: expiresAt <= at means gone.
  const inbox = createInbox();
  const expiresAt = at("2026-08-30T12:15:00Z");
  inbox.add({
    text: "expiring on the minute",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt,
  });

  const live = inbox.live(expiresAt);

  assertEquals(live, []);
});

Deno.test("live: a pruned notice stays gone even when asked about an earlier instant", () => {
  // live prunes as it goes — that is the only garbage collection this feature gets.
  const inbox = createInbox();
  inbox.add({
    text: "pruned",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  inbox.live(at("2026-08-30T12:20:00Z"));
  const live = inbox.live(at("2026-08-30T12:05:00Z"));

  assertEquals(live, []);
});
