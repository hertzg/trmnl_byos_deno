import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Result, RunContext } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

function defaults(): Pick<
  ConductorDeps,
  "errorView" | "errorValidity" | "friendlyId" | "pluginAssetsDir" | "now"
> {
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    now: () => T0,
  };
}

// ─── core orchestration ────────────────────────────────────────────────────

Deno.test("trigger returns the rasterized PNG for the Plugin's Result", async () => {
  const expectedPng = new Uint8Array([1, 2, 3]);
  const run = spy(() => ({
    state: { msg: "hi" },
    validity: fiveMin,
    view: (s: { msg: string }) => `<p>${s.msg}</p>`,
  }));
  const rasterize = spy(() => Promise.resolve(expectedPng));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ msg: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: () => "id",
  });

  const out = await conductor.trigger({ t: T0, intent: "poll" });

  assertEquals(out.png, expectedPng);
  assertSpyCalls(run, 1);
  assertSpyCalls(rasterize, 1);
});

Deno.test("trigger inside the validity window reuses Current Image without re-invoking collaborators", async () => {
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([7])));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => html,
  });

  const first = await conductor.trigger({ t: T0, intent: "poll" });
  const second = await conductor.trigger({ t: T0.add({ minutes: 1 }), intent: "poll" });
  const third = await conductor.trigger({ t: T0.add({ minutes: 4 }), intent: "poll" });

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
  assertEquals(third.png, first.png);
  assertEquals(second.identity, first.identity);
});

Deno.test("when plugin.run throws, trigger falls back to the error view with its configured validity", async () => {
  const errorPng = new Uint8Array([0xee]);
  const boom = new Error("boom");

  const run = spy(() => {
    throw boom;
  });
  const errorView = spy((_err: Error) => "<p>error</p>");
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(errorPng));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    errorView,
  });

  const out = await conductor.trigger({ t: T0, intent: "poll" });

  assertSpyCalls(errorView, 1);
  assertEquals(errorView.calls[0].args[0], boom);
  assertEquals(out.png, errorPng);
  assertEquals(out.identity, "id-<p>error</p>");

  const second = await conductor.trigger({ t: T0.add({ seconds: 20 }), intent: "poll" });
  assertSpyCalls(run, 1);
  assertSpyCalls(errorView, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, errorPng);
});

Deno.test("trigger after expiry rasterizes and replaces Current Image when identity differs", async () => {
  const pngs = [new Uint8Array([1]), new Uint8Array([2])];
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const htmls = ["a", "b"];
  let derive = 0;
  const deriveHtml = spy(() => htmls[derive++]);
  let raster = 0;
  const rasterize = spy(() => Promise.resolve(pngs[raster++]));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
  });

  const first = await conductor.trigger({ t: T0, intent: "poll" });
  const second = await conductor.trigger({ t: T0.add({ minutes: 6 }), intent: "poll" });

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 2);
  assertEquals(first.png, pngs[0]);
  assertEquals(second.png, pngs[1]);
});

Deno.test("trigger after expiry skips rasterize and keeps Current Image when identity matches", async () => {
  const expectedPng = new Uint8Array([42]);
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>stable</p>" }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(expectedPng));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: () => "stable-identity",
  });

  const first = await conductor.trigger({ t: T0, intent: "poll" });
  const second = await conductor.trigger({ t: T0.add({ minutes: 6 }), intent: "poll" });

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 1);
  assertEquals(second.png, first.png);
});

// ─── HTTP sub-app surface ──────────────────────────────────────────────────

function buildHttp(
  overrides: {
    png?: Uint8Array;
    identity?: string;
    validity?: Temporal.Duration;
    friendlyId?: string;
    onDeviceLog?: (id: string, body: string) => void;
    // deno-lint-ignore no-explicit-any
    runImpl?: (ctx: RunContext) => Result<any> | Promise<Result<any>>;
  } = {},
) {
  const png = overrides.png ?? new Uint8Array([0xff]);
  const identity = overrides.identity ?? "deadbeefcafef00d";
  const validity = overrides.validity ?? fiveMin;

  return createConductor({
    ...defaults(),
    friendlyId: overrides.friendlyId ?? "ID",
    onDeviceLog: overrides.onDeviceLog,
    plugin: {
      run: overrides.runImpl ?? (() => ({
        state: {},
        validity,
        view: () => `<p>${identity}</p>`,
      })),
    },
    renderer: {
      deriveHtml: (r) => String(r.view(r.state)),
      rasterize: () => Promise.resolve(png),
    },
    identityFor: () => identity,
  });
}

Deno.test("HTTP GET /api/setup returns BYOS setup JSON with friendlyId", async () => {
  const conductor = buildHttp({ friendlyId: "MY-DEVICE" });

  const res = await conductor.app.request("/api/setup");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 200);
  assertEquals(body.friendly_id, "MY-DEVICE");
});

Deno.test("HTTP GET /api/display returns image_url / filename / refresh_rate derived from the trigger output", async () => {
  const conductor = buildHttp({
    png: new Uint8Array([0x89, 0x50]),
    identity: "deadbeefcafef00d",
    validity: fiveMin,
  });

  const res = await conductor.app.request("/api/display", { headers: { id: "AA:BB:CC" } });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/images/deadbeefcafef00d/png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
});

Deno.test("HTTP GET /api/display forwards a parsed DeviceReport into the next Plugin.run via ctx.device", async () => {
  const runSpy = spy((ctx: RunContext) => ({
    state: { seenId: ctx.device?.id ?? null },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = buildHttp({ runImpl: runSpy });

  await conductor.app.request("/api/display", { headers: { id: "AA:BB:CC" } });

  assertEquals(runSpy.calls.length, 1);
  assertEquals(runSpy.calls[0].args[0].device?.id, "AA:BB:CC");
});

Deno.test("HTTP GET /api/display leaves ctx.device null when the request has no ID header", async () => {
  const runSpy = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = buildHttp({ runImpl: runSpy });

  await conductor.app.request("/api/display");

  assertEquals(runSpy.calls.length, 1);
  assertEquals(runSpy.calls[0].args[0].device, null);
});

Deno.test("HTTP GET /images/:identity/png serves the Current Image PNG when identity matches", async () => {
  const png = new Uint8Array([1, 2, 3, 4]);
  const conductor = buildHttp({ png, identity: "deadbeef00000000" });

  await conductor.app.request("/api/display");
  const res = await conductor.app.request("/images/deadbeef00000000/png");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), png);
});

Deno.test("HTTP GET /images/:identity/png returns 404 for an unknown identity", async () => {
  const conductor = buildHttp({ identity: "knownid000000000" });

  await conductor.app.request("/api/display");
  const res = await conductor.app.request("/images/somethingelse/png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("HTTP POST /api/log returns 204 and invokes onDeviceLog with the id header + body", async () => {
  const onDeviceLog = spy((_id: string, _body: string) => {});
  const conductor = buildHttp({ onDeviceLog });

  const res = await conductor.app.request("/api/log", {
    method: "POST",
    headers: { id: "AA:BB:CC" },
    body: "hello",
  });
  await res.body?.cancel();

  assertEquals(res.status, 204);
  assertEquals(onDeviceLog.calls[0].args, ["AA:BB:CC", "hello"]);
});
