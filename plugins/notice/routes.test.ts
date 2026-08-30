import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import createNoticeRoutes, { type NoticeDeps } from "./routes.ts";
import { inbox } from "./state.ts";

function at(spec: string): Temporal.Instant {
  return Temporal.Instant.from(spec);
}

// The routes read one module-scope inbox (state.ts), so every test starts by
// emptying it. `nextPoll` defaults to a fixed instant so responses are exact.
function freshRoutes(nextPoll = "2026-08-30T12:00:00Z") {
  inbox.clear();
  const deps: NoticeDeps = {
    nextPoll: () => at(nextPoll),
    invalidate: spy(),
  };
  return { app: createNoticeRoutes(deps), invalidate: deps.invalidate as ReturnType<typeof spy> };
}

function form(fields: Record<string, string | File>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return body;
}

Deno.test("POST /notice takes text alone and reports when it shows and goes", async () => {
  const { app } = freshRoutes("2026-08-30T12:00:00Z");

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "Bread is in the oven" }),
  });

  assertEquals(res.status, 200);
  const body = await res.json();
  // The default lifetime is 15 minutes, counted from the next poll.
  assertEquals(body.showsAt, "2026-08-30T12:00:00Z");
  assertEquals(body.expiresAt, "2026-08-30T12:15:00Z");
});

Deno.test("POST /notice starts the lifetime at the next poll, not at arrival", async () => {
  // The whole mechanism behind "sent during the sleep window, scheduled from
  // the next wake-up": sent now, but the panel does not wake until 05:00, so
  // the hour runs 05:00–06:00 rather than expiring in the dark.
  const { app } = freshRoutes("2026-08-31T05:00:00Z");

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "Bins go out", minutes: "60" }),
  });

  const body = await res.json();
  assertEquals(body.showsAt, "2026-08-31T05:00:00Z");
  assertEquals(body.expiresAt, "2026-08-31T06:00:00Z");
});

Deno.test("POST /notice: a notice is still live an hour past its arrival", async () => {
  // Same mechanism read from the inbox's side rather than the response body.
  const { app } = freshRoutes("2026-08-31T05:00:00Z");
  await app.request("/notice", { method: "POST", body: form({ text: "Bins go out" }) });

  assertEquals(inbox.live(at("2026-08-31T05:10:00Z")).length, 1);
});

Deno.test("POST /notice stamps receivedAt at arrival, not at the next poll", async () => {
  // receivedAt is what the bubble labels — when the message was *sent*.
  // Scheduling is showsAt's job, and nothing else may borrow it: reusing
  // showsAt here would label every bubble with the wake-up time instead.
  const { app } = freshRoutes("2026-08-31T05:00:00Z");

  const posted = await (await app.request("/notice", {
    method: "POST",
    body: form({ text: "sent long before the panel wakes" }),
  })).json();
  const { notices } = await (await app.request("/notice")).json();

  assertEquals(
    Temporal.Instant.compare(notices[0].receivedAt, posted.showsAt),
    -1,
  );
});

Deno.test("POST /notice takes a custom duration in minutes", async () => {
  const { app } = freshRoutes("2026-08-30T12:00:00Z");

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "Back in five", minutes: "5" }),
  });

  assertEquals((await res.json()).expiresAt, "2026-08-30T12:05:00Z");
});

Deno.test("POST /notice takes an image alongside the text", async () => {
  const { app } = freshRoutes();
  const image = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "Look at this", image }),
  });

  assertEquals(res.status, 200);
  assertEquals(inbox.live(at("2026-08-30T12:05:00Z"))[0].image, {
    mime: "image/jpeg",
    bytes: new Uint8Array([1, 2, 3]),
  });
});

Deno.test("POST /notice: 400 on text that is empty after trimming", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice", { method: "POST", body: form({ text: "   " }) });

  assertEquals(res.status, 400);
});

Deno.test("POST /notice: 400 on minutes below 1", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "too short", minutes: "0" }),
  });

  assertEquals(res.status, 400);
});

Deno.test("POST /notice: 400 on minutes above a day", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "too long", minutes: "1441" }),
  });

  assertEquals(res.status, 400);
});

Deno.test("POST /notice: 400 on non-integer minutes", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "not a number", minutes: "half an hour" }),
  });

  assertEquals(res.status, 400);
});

Deno.test("POST /notice: 400 on an image over 4 MB", async () => {
  const { app } = freshRoutes();
  const image = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });

  const res = await app.request("/notice", {
    method: "POST",
    body: form({ text: "a huge photo", image }),
  });

  assertEquals(res.status, 400);
});

Deno.test("POST /notice: a rejected notice never reaches the inbox", async () => {
  const { app } = freshRoutes();

  await app.request("/notice", { method: "POST", body: form({ text: "" }) });

  assertEquals(inbox.live(at("2026-08-30T12:05:00Z")), []);
});

Deno.test("POST /notice invalidates the cached Image", async () => {
  const { app, invalidate } = freshRoutes();

  await app.request("/notice", { method: "POST", body: form({ text: "repaint please" }) });

  assertSpyCalls(invalidate, 1);
});

Deno.test("GET /notice lists live notices oldest first, without the bytes", async () => {
  const { app } = freshRoutes();
  inbox.add({
    text: "first",
    image: { mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) },
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2126-08-30T12:15:00Z"),
  });
  inbox.add({
    text: "second",
    receivedAt: at("2026-08-30T12:01:00Z"),
    expiresAt: at("2126-08-30T12:16:00Z"),
  });

  const res = await app.request("/notice");

  assertEquals(res.status, 200);
  const { notices } = await res.json();
  assertEquals(notices.map((n: { text: string }) => n.text), ["first", "second"]);
  assertEquals(notices.map((n: { hasImage: boolean }) => n.hasImage), [true, false]);
  assertEquals(Object.keys(notices[0]), ["id", "text", "hasImage", "receivedAt", "expiresAt"]);
});

Deno.test("GET /notice omits a notice whose lifetime has run out", async () => {
  const { app } = freshRoutes();
  inbox.add({
    text: "long gone",
    receivedAt: at("2020-01-01T00:00:00Z"),
    expiresAt: at("2020-01-01T00:15:00Z"),
  });

  const res = await app.request("/notice");

  assertEquals((await res.json()).notices, []);
});

Deno.test("DELETE /notice/:id removes the notice and says so", async () => {
  const { app } = freshRoutes();
  const notice = inbox.add({
    text: "remove me",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2126-08-30T12:15:00Z"),
  });

  const res = await app.request(`/notice/${notice.id}`, { method: "DELETE" });

  assertEquals(await res.json(), { removed: true });
  assertEquals(inbox.live(at("2026-08-30T12:05:00Z")), []);
});

Deno.test("DELETE /notice/:id reports false for an id it does not hold", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice/id-that-was-never-issued", { method: "DELETE" });

  assertEquals(await res.json(), { removed: false });
});

Deno.test("DELETE /notice/:id invalidates the cached Image", async () => {
  const { app, invalidate } = freshRoutes();
  const notice = inbox.add({
    text: "remove me",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2126-08-30T12:15:00Z"),
  });

  await app.request(`/notice/${notice.id}`, { method: "DELETE" });

  assertSpyCalls(invalidate, 1);
});

Deno.test("DELETE /notice clears everything and counts what it cleared", async () => {
  const { app } = freshRoutes();
  inbox.add({
    text: "one",
    receivedAt: at("2026-08-30T12:00:00Z"),
    expiresAt: at("2126-08-30T12:15:00Z"),
  });
  inbox.add({
    text: "two",
    receivedAt: at("2026-08-30T12:01:00Z"),
    expiresAt: at("2126-08-30T12:16:00Z"),
  });

  const res = await app.request("/notice", { method: "DELETE" });

  assertEquals(await res.json(), { removed: 2 });
  assertEquals(inbox.live(at("2026-08-30T12:05:00Z")), []);
});

Deno.test("DELETE /notice invalidates the cached Image", async () => {
  const { app, invalidate } = freshRoutes();

  await app.request("/notice", { method: "DELETE" });

  assertSpyCalls(invalidate, 1);
});

Deno.test("GET /notice/app serves the control page", async () => {
  const { app } = freshRoutes();

  const res = await app.request("/notice/app");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=UTF-8");
  assertStringIncludes(await res.text(), "<!doctype html>");
});

Deno.test("GET /notice/app is never cached", async () => {
  // It lives on a Home Screen, so a copy held across a redeploy is the one
  // stale page that would actually be annoying.
  const { app } = freshRoutes();

  const res = await app.request("/notice/app");
  await res.body?.cancel();

  assertEquals(res.headers.get("cache-control"), "no-store");
});
