import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Result, RunContext } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

function defaults(
  overrides: Partial<ConductorDeps> = {},
): Pick<
  ConductorDeps,
  "errorView" | "errorValidity" | "friendlyId" | "pluginAssetsDir" | "now"
> {
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    pluginAssetsDir: "/tmp",
    now: () => T0,
    ...overrides,
  };
}

// ─── derive() ──────────────────────────────────────────────────────────────

Deno.test("derive runs Plugin + deriveHtml + identityFor and surfaces all three on the result", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));
  const deriveHtml = spy((r: Result<{ intent: string }>) => String(r.view(r.state)));
  const identityFor = spy((html: string) => `id-${html}`);

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    deriveHtml,
    identityFor,
  });

  const out = await conductor.derive(T0);

  assertEquals(out.html, "<p>scrub</p>");
  assertEquals(out.identity, "id-<p>scrub</p>");
  assertEquals(out.error, null);
  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(identityFor, 1);
});

Deno.test("derive defaults intent to scrub and forwards the caller's intent when supplied", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  await conductor.derive(T0);
  await conductor.derive(T0, "prerender");

  assertEquals(run.calls[0].args[0].intent, "scrub");
  assertEquals(run.calls[1].args[0].intent, "prerender");
});

Deno.test("derive falls back to the error view when Plugin.run throws", async () => {
  const boom = new Error("boom");
  const errorView = spy((_err: Error) => "ERR");
  const conductor = createConductor({
    ...defaults({ errorView }),
    plugin: {
      run: () => {
        throw boom;
      },
    },
    deriveHtml: (r: Result<unknown>) => String(r.view(r.state)),
    identityFor: (html) => `id-${html}`,
  });

  const out = await conductor.derive(T0);

  assertEquals(out.error, boom);
  assertEquals(out.html, "ERR");
  assertEquals(out.identity, "id-ERR");
  assertSpyCalls(errorView, 1);
});

Deno.test("derive falls back to the error view when deriveHtml throws", async () => {
  const boom = new Error("derive boom");
  const errorView = spy((_err: Error) => "ERR");
  let calls = 0;
  const conductor = createConductor({
    ...defaults({ errorView }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>real</p>" }) },
    deriveHtml: (r: Result<unknown>) => {
      calls++;
      if (calls === 1) throw boom;
      return String(r.view(r.state));
    },
    identityFor: (html) => `id-${html}`,
  });

  const out = await conductor.derive(T0);

  assertEquals(out.error, boom);
  assertEquals(out.html, "ERR");
  assertEquals(out.identity, "id-ERR");
});

// ─── BYOS surface ──────────────────────────────────────────────────────────

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId and image_url pointing at /preview/png", async () => {
  const conductor = createConductor({
    ...defaults({ friendlyId: "MY-DEVICE" }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    deriveHtml: () => "",
    identityFor: () => "x",
  });

  const res = await conductor.app.request("/api/setup");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 200);
  assertEquals(body.friendly_id, "MY-DEVICE");
  assertEquals(body.image_url, "http://localhost/preview/png");
});

Deno.test("GET /api/display returns image_url=/preview/png, filename from identity, refresh_rate from validity", async () => {
  const conductor = createConductor({
    ...defaults(),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "deadbeefcafef00d",
  });

  const res = await conductor.app.request("/api/display", { headers: { id: "AA:BB:CC" } });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/preview/png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
});

Deno.test("GET /api/display runs the Plugin with intent=poll", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "x",
  });

  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].intent, "poll");
});

Deno.test("GET /api/display forwards the latest parsed DeviceReport into the next Plugin.run via ctx.device", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { seenId: ctx.device?.id ?? null },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "x",
  });

  await (await conductor.app.request("/api/display", { headers: { id: "AA:BB:CC" } })).body
    ?.cancel();
  // A second poll without headers still sees the previous device — the
  // Conductor remembers `latestDevice`.
  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(run.calls.length, 2);
  assertEquals(run.calls[0].args[0].device?.id, "AA:BB:CC");
  assertEquals(run.calls[1].args[0].device?.id, "AA:BB:CC");
});

Deno.test("GET /api/display leaves ctx.device null when no Device has polled yet", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "x",
  });

  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].device, null);
});

Deno.test("GET /api/display falls back to the error view filename when the Plugin throws", async () => {
  const conductor = createConductor({
    ...defaults(),
    plugin: {
      run: () => {
        throw new Error("boom");
      },
    },
    deriveHtml: (r: Result<unknown>) => String(r.view(r.state)),
    identityFor: (html) => `id-${html}`,
    errorView: (_err: Error) => "ERR",
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  // /api/display still answers OK — the Plugin error becomes an error-view
  // Result whose 30s validity governs refresh_rate.
  assertEquals(res.status, 200);
  assertEquals(body.filename, "image-id-ERR");
  assertEquals(body.refresh_rate, 30);
});

// ─── /assets/* ─────────────────────────────────────────────────────────────

Deno.test("GET /assets/:file serves files from pluginAssetsDir without the /assets prefix duplicating in the path", async () => {
  const assetsDir = await Deno.makeTempDir({ prefix: "conductor-assets-test-" });
  await Deno.writeTextFile(`${assetsDir}/style.css`, ".x { color: red; }");

  const conductor = createConductor({
    ...defaults({ pluginAssetsDir: assetsDir }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    deriveHtml: () => "",
    identityFor: () => "x",
  });

  const res = await conductor.app.request("/assets/style.css");

  assertEquals(res.status, 200);
  assertEquals(await res.text(), ".x { color: red; }");
});

// ─── /api/log ──────────────────────────────────────────────────────────────

Deno.test("POST /api/log returns 204 and invokes onDeviceLog with the id header + body", async () => {
  const onDeviceLog = spy((_id: string, _body: string) => {});
  const conductor = createConductor({
    ...defaults({ onDeviceLog }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    deriveHtml: () => "",
    identityFor: () => "x",
  });

  const res = await conductor.app.request("/api/log", {
    method: "POST",
    headers: { id: "AA:BB:CC" },
    body: "hello",
  });
  await res.body?.cancel();

  assertEquals(res.status, 204);
  assertEquals(onDeviceLog.calls[0].args, ["AA:BB:CC", "hello"]);
});
