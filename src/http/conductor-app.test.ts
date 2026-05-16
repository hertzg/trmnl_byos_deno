import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { spy } from "@std/testing/mock";
import { createConductorApp } from "./conductor-app.ts";
import type { Conductor, TriggerOutput } from "../conductor/conductor.ts";

function stubConductor(out: TriggerOutput): Conductor {
  return {
    trigger: () => Promise.resolve(out),
    getCurrentImage: (id) => (id === out.identity ? out.png : undefined),
  };
}

function deviceHolder() {
  let last: Record<string, unknown> = {};
  return {
    get: () => last,
    updateFromHeaders: (h: Headers) => {
      last = { id: h.get("id") };
    },
  };
}

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId", async () => {
  const app = createConductorApp({
    conductor: stubConductor({
      png: new Uint8Array(),
      identity: "x",
      expiresAt: Temporal.Now.zonedDateTimeISO(),
    }),
    deviceHolder: deviceHolder(),
    friendlyId: "MY-DEVICE",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    now: () => Temporal.Now.zonedDateTimeISO(),
  });

  const res = await app.fetch(new Request("http://x.example/api/setup"));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 200);
  assertEquals(body.friendly_id, "MY-DEVICE");
});

Deno.test("GET /api/display triggers a poll, captures the device headers, and returns image_url / filename / refresh_rate", async () => {
  const png = new Uint8Array([0x89, 0x50]);
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
  const expiresAt = now.add({ minutes: 5 });

  const trigger = spy(() =>
    Promise.resolve({ png, identity: "deadbeefcafef00d", expiresAt })
  );
  const holder = deviceHolder();

  const app = createConductorApp({
    conductor: {
      trigger,
      getCurrentImage: (id) => (id === "deadbeefcafef00d" ? png : undefined),
    },
    deviceHolder: holder,
    friendlyId: "MY-DEVICE",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    now: () => now,
  });

  const res = await app.fetch(
    new Request("http://x.example/api/display", { headers: { id: "AA:BB:CC" } }),
  );
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://x.example/images/deadbeefcafef00d/png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
  assertEquals(holder.get(), { id: "AA:BB:CC" });
});

Deno.test("GET /images/:identity/png serves the Current Image PNG when identity matches", async () => {
  const png = new Uint8Array([1, 2, 3, 4]);
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");

  // Prime the conductor: trigger has been called once so currentImage holds `png`/`deadbeef`.
  const stub = stubConductor({
    png,
    identity: "deadbeef00000000",
    expiresAt: now.add({ minutes: 5 }),
  });

  const app = createConductorApp({
    conductor: stub,
    deviceHolder: deviceHolder(),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    now: () => now,
  });

  await app.fetch(new Request("http://x/api/display"));
  const res = await app.fetch(new Request("http://x/images/deadbeef00000000/png"));

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), png);
});

Deno.test("GET /images/:identity/png returns 404 for an unknown identity", async () => {
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
  const app = createConductorApp({
    conductor: stubConductor({
      png: new Uint8Array([9]),
      identity: "knownid000000000",
      expiresAt: now.add({ minutes: 5 }),
    }),
    deviceHolder: deviceHolder(),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    now: () => now,
  });

  await app.fetch(new Request("http://x/api/display"));
  const res = await app.fetch(new Request("http://x/images/somethingelse/png"));
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /preview/:id returns shelved HTML for the internal CDP fetch-back", async () => {
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
  const shelved = new Map([["abc", "<!DOCTYPE html><p>x</p>"]]);
  const shelf = {
    shelve: (html: string) => {
      shelved.set("new", html);
      return "new";
    },
    fetch: (id: string) => shelved.get(id),
    remove: (id: string) => {
      shelved.delete(id);
    },
  };

  const app = createConductorApp({
    conductor: stubConductor({
      png: new Uint8Array(),
      identity: "x",
      expiresAt: now,
    }),
    deviceHolder: deviceHolder(),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: shelf,
    now: () => now,
  });

  const res = await app.fetch(new Request("http://x/preview/abc"));

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(await res.text(), "<!DOCTYPE html><p>x</p>");
});

Deno.test("GET /preview/:id returns 404 for a missing shelf entry", async () => {
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
  const app = createConductorApp({
    conductor: stubConductor({ png: new Uint8Array(), identity: "x", expiresAt: now }),
    deviceHolder: deviceHolder(),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    now: () => now,
  });

  const res = await app.fetch(new Request("http://x/preview/missing"));
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("POST /api/log returns 204", async () => {
  const now = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
  const onDeviceLog = spy((_id: string, _body: string) => {});

  const app = createConductorApp({
    conductor: stubConductor({ png: new Uint8Array(), identity: "x", expiresAt: now }),
    deviceHolder: deviceHolder(),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: { shelve: () => "id", fetch: () => undefined, remove: () => {} },
    onDeviceLog,
    now: () => now,
  });

  const res = await app.fetch(
    new Request("http://x/api/log", {
      method: "POST",
      headers: { id: "AA:BB:CC" },
      body: "hello",
    }),
  );
  await res.body?.cancel();

  assertEquals(res.status, 204);
  assertEquals(onDeviceLog.calls[0].args, ["AA:BB:CC", "hello"]);
});
