import { assertEquals, assertNotEquals } from "@std/assert";
import { createInbox, DEFAULT_MINUTES } from "./inbox.ts";

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

Deno.test("live: asking about a future instant removes nothing", () => {
  // live is a pure filter, not a garbage collector. The dashboard runs Plugins
  // at an arbitrary scrubbed instant, and a read-only debug surface must not
  // be able to destroy real state.
  const inbox = createInbox();
  inbox.add({
    text: "still live at 12:05",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  inbox.live(at("2026-08-30T12:20:00Z"));
  const live = inbox.live(at("2026-08-30T12:05:00Z"));

  assertEquals(live.map((n) => n.text), ["still live at 12:05"]);
});

Deno.test("add: drops entries that had already expired when the new one arrived", () => {
  // Writes may prune, reads may not. Keeping live() a pure filter is what
  // makes a dashboard scrub safe; an entry can still hold 4 MB of image
  // bytes, so a write is where those get freed.
  const inbox = createInbox();
  inbox.add({
    text: "long gone",
    receivedAt: at("2026-08-30T11:00:00Z"),
    expiresAt: at("2026-08-30T11:15:00Z"),
  });

  inbox.add({
    text: "arriving at noon",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  // Asked about 11:10, when the first notice was still live: it is not merely
  // filtered out, it is gone.
  assertEquals(inbox.live(at("2026-08-30T11:10:00Z")).map((n) => n.text), ["arriving at noon"]);
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

Deno.test("nextExpiry: null when every notice has already expired", () => {
  const inbox = createInbox();
  inbox.add({
    text: "long gone",
    receivedAt: at("2026-08-30T11:00:00Z"),
    expiresAt: at("2026-08-30T11:15:00Z"),
  });

  const next = inbox.nextExpiry(at("2026-08-30T12:05:00Z"));

  assertEquals(next, null);
});

Deno.test("remove: true for a live id, and the notice is gone", () => {
  const inbox = createInbox();
  const notice = inbox.add({
    text: "remove me",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  const removed = inbox.remove(notice.id);

  assertEquals(removed, true);
  assertEquals(inbox.live(at("2026-08-30T12:05:00Z")), []);
});

Deno.test("remove: false for an unknown id", () => {
  const inbox = createInbox();
  inbox.add({
    text: "still here",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  const removed = inbox.remove("id-that-was-never-issued");

  assertEquals(removed, false);
});

Deno.test("clear: empties the inbox", () => {
  const inbox = createInbox();
  inbox.add({
    text: "one",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });
  inbox.add({
    text: "two",
    receivedAt: at("2026-08-30T12:01:00Z"),
    expiresAt: at("2026-08-30T12:16:00Z"),
  });

  inbox.clear();

  assertEquals(inbox.live(at("2026-08-30T12:05:00Z")), []);
});

Deno.test("add: an image round-trips through live", () => {
  const inbox = createInbox();
  const image = { mime: "image/heic", bytes: new Uint8Array([1, 2, 3]) };
  inbox.add({
    text: "with a photo",
    image,
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  const live = inbox.live(at("2026-08-30T12:05:00Z"));

  assertEquals(live[0].image, { mime: "image/heic", bytes: new Uint8Array([1, 2, 3]) });
});

Deno.test("add: a notice sent without an image has a null image", () => {
  const inbox = createInbox();
  inbox.add({
    text: "text only",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  const live = inbox.live(at("2026-08-30T12:05:00Z"));

  assertEquals(live[0].image, null);
});

Deno.test("createInbox: two inboxes hold their own notices", () => {
  // A factory, not a module-scope singleton.
  const one = createInbox();
  const other = createInbox();
  one.add({
    text: "only in one",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });

  const live = other.live(at("2026-08-30T12:05:00Z"));

  assertEquals(live, []);
});

Deno.test("DEFAULT_MINUTES: the default notice lifetime is 15 minutes", () => {
  // Written here once; the route applies it, the inbox never does.
  assertEquals(DEFAULT_MINUTES, 15);
});

Deno.test("add: the returned notice carries the caller's text and instants", () => {
  const inbox = createInbox();
  const receivedAt = at("2026-08-30T12:00:00Z");
  const expiresAt = at("2026-08-30T12:15:00Z");

  const notice = inbox.add({ text: "carried through", receivedAt, expiresAt });

  assertEquals(notice.text, "carried through");
  assertEquals(notice.receivedAt, receivedAt);
  assertEquals(notice.expiresAt, expiresAt);
});

Deno.test("add: each notice gets its own id", () => {
  const inbox = createInbox();

  const first = inbox.add({
    text: "first",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T12:15:00Z"),
  });
  const second = inbox.add({
    text: "second",
    receivedAt: at("2026-08-30T12:01:00Z"),
    expiresAt: at("2026-08-30T12:16:00Z"),
  });

  assertNotEquals(first.id, second.id);
});
