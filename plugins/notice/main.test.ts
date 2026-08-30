import { assertEquals } from "@std/assert";
import type { RunContext } from "@hztrmnl/server/plugin";
import NoticePlugin from "./main.ts";
import { inbox } from "./state.ts";

function at(spec: string): Temporal.Instant {
  return Temporal.Instant.from(spec);
}

// The Plugin reads one module-scope inbox (state.ts), so every test starts by
// emptying it.
function freshInbox() {
  inbox.clear();
  return inbox;
}

function ctx(t: string, intent: RunContext["intent"] = "poll"): RunContext {
  return { t: Temporal.ZonedDateTime.from(t), intent, device: null };
}

/** A notice that stays live for the whole of 2026-08-30 lunchtime. */
function addAt(text: string, receivedAt: string, expiresAt = "2026-08-30T13:00:00Z") {
  return inbox.add({ text, receivedAt: at(receivedAt), expiresAt: at(expiresAt) });
}

Deno.test("run on an empty inbox is a valid Result with no notices", () => {
  freshInbox();

  const result = NoticePlugin.run(ctx("2026-08-30T14:00:00+02:00[Europe/Berlin]"));

  assertEquals(result.state, { notices: [], earlierCount: 0 });
});

Deno.test("run on an empty inbox falls back to a nominal hour of validity", () => {
  freshInbox();

  const result = NoticePlugin.run(ctx("2026-08-30T14:00:00+02:00[Europe/Berlin]"));

  assertEquals(result.validity.total({ unit: "minutes" }), 60);
});

Deno.test("run draws the live notices, oldest first", () => {
  freshInbox();
  addAt("first", "2026-08-30T12:00:00Z");
  addAt("second", "2026-08-30T12:05:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  assertEquals(result.state.notices.map((n) => n.text), ["first", "second"]);
});

Deno.test("run caps the thread at the newest five and rolls the rest up", () => {
  freshInbox();
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    addAt(`notice ${n}`, `2026-08-30T12:0${n}:00Z`);
  }

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  assertEquals(
    result.state.notices.map((n) => n.text),
    ["notice 3", "notice 4", "notice 5", "notice 6", "notice 7"],
  );
  assertEquals(result.state.earlierCount, 2);
});

Deno.test("run reports no earlier notices when the whole thread fits", () => {
  freshInbox();
  addAt("only one", "2026-08-30T12:00:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  assertEquals(result.state.earlierCount, 0);
});

Deno.test("run labels a notice with the time it was sent, in the context's zone", () => {
  freshInbox();
  addAt("sent at six past six, UTC", "2026-08-30T06:12:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  // Berlin is UTC+2 in August, so 06:12Z reads as 08:12 on the panel.
  assertEquals(result.state.notices[0].timeLabel, "08:12");
});

Deno.test("run labels the same notice differently in a different zone", () => {
  freshInbox();
  addAt("sent at six past six, UTC", "2026-08-30T06:12:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T06:12:00+00:00[UTC]"));

  assertEquals(result.state.notices[0].timeLabel, "06:12");
});

Deno.test("run carries an uploaded image through as a data URL", () => {
  freshInbox();
  inbox.add({
    text: "look at this",
    image: { mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) },
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2026-08-30T13:00:00Z"),
  });

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  assertEquals(result.state.notices[0].imageDataUrl, "data:image/jpeg;base64,AQID");
});

Deno.test("run leaves a text-only notice without an image", () => {
  freshInbox();
  addAt("text only", "2026-08-30T12:00:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T14:10:00+02:00[Europe/Berlin]"));

  assertEquals(result.state.notices[0].imageDataUrl, null);
});

Deno.test("run's validity runs out exactly when the first notice does", () => {
  freshInbox();
  addAt("goes at 13:00", "2026-08-30T12:00:00Z", "2026-08-30T13:00:00Z");
  addAt("goes at 14:00", "2026-08-30T12:01:00Z", "2026-08-30T14:00:00Z");

  const result = NoticePlugin.run(ctx("2026-08-30T14:30:00+02:00[Europe/Berlin]"));

  // 12:30Z to the earliest expiry at 13:00Z.
  assertEquals(result.validity.total({ unit: "minutes" }), 30);
});

Deno.test("run is pure: a scrub at a future t leaves the inbox intact", () => {
  // The dashboard runs Plugins at an arbitrary scrubbed instant. A read-only
  // debug surface must not be able to destroy real notices.
  freshInbox();
  addAt("still live at lunchtime", "2026-08-30T12:00:00Z", "2026-08-30T13:00:00Z");

  NoticePlugin.run(ctx("2026-08-31T20:00:00+02:00[Europe/Berlin]", "scrub"));

  assertEquals(inbox.live(at("2026-08-30T12:30:00Z")).length, 1);
});

Deno.test("run returns no hints — identity follows from the state", () => {
  freshInbox();

  const result = NoticePlugin.run(ctx("2026-08-30T14:00:00+02:00[Europe/Berlin]"));

  assertEquals(result.hints, undefined);
});
