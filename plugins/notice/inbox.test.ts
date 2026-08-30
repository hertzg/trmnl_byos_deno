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

Deno.test("nextExpiry: picks the earliest expiry after the given instant", () => {
  // Arrival order and expiry order need not agree — the sender picks the duration.
  const inbox = createInbox();
  inbox.add({
    text: "an hour",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T13:00:00Z"),
  });
  inbox.add({
    text: "a quarter of an hour",
    receivedAt: at("2026-08-30T12:01:00Z"),
    expiresAt: at("2026-08-30T12:16:00Z"),
  });

  const next = inbox.nextExpiry(at("2026-08-30T12:05:00Z"));

  assertEquals(next, at("2026-08-30T12:16:00Z"));
});

Deno.test("nextExpiry: an expiry at exactly the given instant is not in the future", () => {
  // Strictly after, matching live's exclusive boundary.
  const inbox = createInbox();
  const expiresAt = at("2026-08-30T12:15:00Z");
  inbox.add({
    text: "expiring on the minute",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt,
  });

  const next = inbox.nextExpiry(expiresAt);

  assertEquals(next, null);
});

Deno.test("nextExpiry: null on an empty inbox", () => {
  const inbox = createInbox();

  const next = inbox.nextExpiry(at("2026-08-30T12:05:00Z"));

  assertEquals(next, null);
});
