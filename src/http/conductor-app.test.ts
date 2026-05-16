import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { spy } from "@std/testing/mock";
import { createConductorApp } from "./conductor-app.ts";
import type { Conductor, TriggerOutput } from "../conductor/conductor.ts";
import { createDeviceReportHolder } from "../device.ts";
import type { HtmlShelf } from "../render/html-shelf.ts";

const T0 = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");

function buildApp(
  overrides: {
    triggerOutput?: TriggerOutput;
    conductor?: Conductor;
    htmlShelf?: HtmlShelf;
    onDeviceLog?: (id: string, body: string) => void;
    now?: () => Temporal.ZonedDateTime;
    friendlyId?: string;
  } = {},
) {
  const realHolder = createDeviceReportHolder();
  const holder = {
    get: realHolder.get,
    updateFromHeaders: (h: Headers) => realHolder.updateFromHeaders(h, () => T0),
  };

  const out = overrides.triggerOutput ??
    { png: new Uint8Array(), identity: "x", expiresAt: T0 };

  const app = createConductorApp({
    conductor: overrides.conductor ?? {
      trigger: () => Promise.resolve(out),
      getCurrentImage: (id) => (id === out.identity ? out.png : undefined),
    },
    deviceHolder: holder,
    friendlyId: overrides.friendlyId ?? "ID",
    pluginAssetsDir: "/tmp",
    htmlShelf: overrides.htmlShelf ?? {
      shelve: () => "id",
      fetch: () => undefined,
      remove: () => {},
    },
    onDeviceLog: overrides.onDeviceLog,
    now: overrides.now ?? (() => T0),
  });

  return { app, holder };
}

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId", async () => {
  const { app } = buildApp({ friendlyId: "MY-DEVICE" });

  const res = await app.request("/api/setup");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 200);
  assertEquals(body.friendly_id, "MY-DEVICE");
});

Deno.test("GET /api/display triggers a poll, captures the device headers, and returns image_url / filename / refresh_rate", async () => {
  const png = new Uint8Array([0x89, 0x50]);
  const expiresAt = T0.add({ minutes: 5 });
  const trigger = spy(() => Promise.resolve({ png, identity: "deadbeefcafef00d", expiresAt }));

  const { app, holder } = buildApp({
    conductor: {
      trigger,
      getCurrentImage: (id) => (id === "deadbeefcafef00d" ? png : undefined),
    },
  });

  const res = await app.request("/api/display", { headers: { id: "AA:BB:CC" } });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/images/deadbeefcafef00d/png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
  assertEquals(holder.get()?.id, "AA:BB:CC");
});

Deno.test("GET /images/:identity/png serves the Current Image PNG when identity matches", async () => {
  const png = new Uint8Array([1, 2, 3, 4]);
  const { app } = buildApp({
    triggerOutput: { png, identity: "deadbeef00000000", expiresAt: T0.add({ minutes: 5 }) },
  });

  await app.request("/api/display");
  const res = await app.request("/images/deadbeef00000000/png");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), png);
});

Deno.test("GET /images/:identity/png returns 404 for an unknown identity", async () => {
  const { app } = buildApp({
    triggerOutput: {
      png: new Uint8Array([9]),
      identity: "knownid000000000",
      expiresAt: T0.add({ minutes: 5 }),
    },
  });

  await app.request("/api/display");
  const res = await app.request("/images/somethingelse/png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /preview/:id returns shelved HTML for the internal CDP fetch-back", async () => {
  const shelved = new Map([["abc", "<!DOCTYPE html><p>x</p>"]]);
  const shelf: HtmlShelf = {
    shelve: (html) => {
      shelved.set("new", html);
      return "new";
    },
    fetch: (id) => shelved.get(id),
    remove: (id) => {
      shelved.delete(id);
    },
  };

  const { app } = buildApp({ htmlShelf: shelf });

  const res = await app.request("/preview/abc");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(await res.text(), "<!DOCTYPE html><p>x</p>");
});

Deno.test("GET /preview/:id returns 404 for a missing shelf entry", async () => {
  const { app } = buildApp();

  const res = await app.request("/preview/missing");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("POST /api/log returns 204", async () => {
  const onDeviceLog = spy((_id: string, _body: string) => {});
  const { app } = buildApp({ onDeviceLog });

  const res = await app.request("/api/log", {
    method: "POST",
    headers: { id: "AA:BB:CC" },
    body: "hello",
  });
  await res.body?.cancel();

  assertEquals(res.status, 204);
  assertEquals(onDeviceLog.calls[0].args, ["AA:BB:CC", "hello"]);
});
