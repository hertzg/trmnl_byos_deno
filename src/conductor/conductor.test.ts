import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Plugin, RunContext } from "../plugin/plugin.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Bundle } from "../plugin/bundle.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

// Wrap a Plugin in a stub PluginManager so test bodies keep speaking
// "Plugin run returns ..." while the Conductor consumes a Bundle. The asset
// map is empty: nothing under test here consults it.
function managerFor(plugin: Plugin<unknown>): PluginManager {
  return {
    async run(ctx) {
      const result = await plugin.run(ctx);
      return { result, assets: {} };
    },
  };
}

// A fake Renderer whose `identity` derives a deterministic, inspectable
// string from the Bundle's rendered view output — tests can then assert on
// `out.identity` without re-implementing hashBundle. `rasterize` is unused
// by `derive()` itself (Slot/Image path lives outside this slice).
function fakeRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    identity: (b: Bundle) => Promise.resolve(`id-${String(b.result.view(b.result.state))}`),
    rasterize: () => Promise.resolve(new Uint8Array()),
    ...overrides,
  };
}

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

Deno.test("derive runs Plugin + Renderer.identity and surfaces the Bundle on the result", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));
  const identity = spy((b: Bundle) =>
    Promise.resolve(`id-${String(b.result.view(b.result.state))}`)
  );

  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer({ identity }),
  });

  const out = await conductor.derive(T0);

  assertEquals(out.identity, "id-<p>scrub</p>");
  assertEquals(out.bundle.assets, {});
  assertEquals(out.error, null);
  assertSpyCalls(run, 1);
  assertSpyCalls(identity, 1);
  // The Bundle handed to Renderer.identity carries the Plugin's Result.
  assertEquals(identity.calls[0].args[0].result.state, { intent: "scrub" });
});

Deno.test("derive defaults intent to scrub and forwards the caller's intent when supplied", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({
      run: () => {
        throw boom;
      },
    }),
    renderer: fakeRenderer(),
  });

  const out = await conductor.derive(T0);

  assertEquals(out.error, boom);
  assertEquals(out.identity, "id-ERR");
  assertSpyCalls(errorView, 1);
  // The error Bundle is still a Bundle: the Renderer saw the error view's
  // Result in its assets-empty form.
  assertEquals(out.bundle.result.state, boom);
});

Deno.test("derive falls back to the error view when Renderer.identity throws", async () => {
  const boom = new Error("identity boom");
  const errorView = spy((_err: Error) => "ERR");
  let calls = 0;
  const conductor = createConductor({
    ...defaults({ errorView }),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>real</p>" }),
    }),
    renderer: fakeRenderer({
      identity: (b) => {
        calls++;
        if (calls === 1) return Promise.reject(boom);
        return Promise.resolve(`id-${String(b.result.view(b.result.state))}`);
      },
    }),
  });

  const out = await conductor.derive(T0);

  assertEquals(out.error, boom);
  assertEquals(out.identity, "id-ERR");
});

// ─── BYOS surface ──────────────────────────────────────────────────────────

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId and image_url pointing at /preview/png", async () => {
  const conductor = createConductor({
    ...defaults({ friendlyId: "MY-DEVICE" }),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: fakeRenderer({ identity: () => Promise.resolve("deadbeefcafef00d") }),
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
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer(),
  });

  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].device, null);
});

Deno.test("GET /api/display falls back to the error view filename when the Plugin throws", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => {
        throw new Error("boom");
      },
    }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: fakeRenderer(),
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
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: fakeRenderer(),
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
