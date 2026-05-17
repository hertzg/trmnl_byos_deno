import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Plugin, RunContext } from "../plugin/plugin.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Bundle } from "../plugin/bundle.ts";
import { createSlot } from "../slot/slot.ts";

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
// `out.identity` without re-implementing hashBundle. `rasterize` returns a
// short PNG-magic byte sequence so the /image/<id>.png route can hand back
// recognisable bytes without spinning CDP.
function fakeRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    identity: (b: Bundle) => Promise.resolve(`id-${String(b.result.view(b.result.state))}`),
    rasterize: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    origin: () => "http://127.0.0.1:0",
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function defaults(
  overrides: Partial<ConductorDeps> = {},
): Pick<
  ConductorDeps,
  "errorView" | "errorValidity" | "friendlyId" | "now" | "slot"
> {
  const now = overrides.now ?? (() => T0);
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    now,
    slot: createSlot({ now }),
    ...overrides,
  };
}

// ─── /api/display: BYOS shape ──────────────────────────────────────────────

Deno.test("GET /api/display returns BYOS JSON with image_url=/image/<identity>.png and filename=image-<identity>", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: fakeRenderer({ identity: () => Promise.resolve("deadbeefcafef00d") }),
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/image/deadbeefcafef00d.png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
});

// ─── /api/setup, /api/log, /assets/* ───────────────────────────────────────

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId and a placeholder /image/setup.png URL", async () => {
  // At setup time the Slot is cold and may not have a meaningful identity
  // yet. We return /image/setup.png as a syntactic placeholder; the
  // firmware proceeds straight to /api/display, which returns the real
  // identity-keyed URL on the first poll.
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
  assertEquals(body.image_url, "http://localhost/image/setup.png");
});

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

Deno.test("GET /assets/<anything> returns 404 — Plugin assets travel inside the Bundle to Renderer's loopback only", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: fakeRenderer(),
  });

  const res = await conductor.app.request("/assets/style.css");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

// ─── DeviceReport carry-through ────────────────────────────────────────────

Deno.test("GET /api/display threads the latest parsed DeviceReport into the next Plugin.run via ctx.device", async () => {
  const seen: { ids: Array<string | null> } = { ids: [] };
  let clock = T0;
  const now = () => clock;
  const conductor = createConductor({
    ...defaults({ now, slot: createSlot({ now }) }),
    pluginManager: managerFor({
      run: (ctx) => {
        seen.ids.push(ctx.device?.id ?? null);
        return { state: {}, validity: fiveMin, view: () => "<p>x</p>" };
      },
    }),
    renderer: fakeRenderer({
      identity: (b) =>
        // Different identity per call so the Slot rolls on every poll
        // and the next call falls through to Plugin.run again.
        Promise.resolve(`id-${seen.ids.length}-${String(b.result.view(b.result.state))}`),
    }),
  });

  // First poll: header present → latestDevice set; ctx.device.id seen.
  await (await conductor.app.request("/api/display", { headers: { id: "AA:BB:CC" } })).body
    ?.cancel();
  // Roll past validity so the second poll triggers a fresh refill.
  clock = T0.add(Temporal.Duration.from({ minutes: 5 }));
  // Second poll: no header. The Conductor remembers latestDevice so
  // ctx.device.id stays "AA:BB:CC".
  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(seen.ids, ["AA:BB:CC", "AA:BB:CC"]);
});

Deno.test("GET /api/display leaves ctx.device null when no Device has polled yet", async () => {
  const seen: { device: unknown } = { device: undefined };
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: (ctx) => {
        seen.device = ctx.device;
        return { state: {}, validity: fiveMin, view: () => "<p>x</p>" };
      },
    }),
    renderer: fakeRenderer(),
  });

  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(seen.device, null);
});

Deno.test("GET /api/display passes intent=poll into the Plugin", async () => {
  const seen: { intents: string[] } = { intents: [] };
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: (ctx) => {
        seen.intents.push(ctx.intent);
        return { state: {}, validity: fiveMin, view: () => "<p>x</p>" };
      },
    }),
    renderer: fakeRenderer(),
  });

  await (await conductor.app.request("/api/display")).body?.cancel();

  assertEquals(seen.intents, ["poll"]);
});

// ─── Single-flight: concurrent /api/display polls dedupe Plugin runs ──────

Deno.test("concurrent /api/display polls during a cache miss share one Plugin run", async () => {
  // Two simultaneous polls arrive while the Slot is empty. Without
  // single-flight both would race `refillSlot` and the Plugin would
  // observe `run` calls equal to the concurrency. The orchestration
  // dedupes them so only one Plugin run / Renderer.identity / rasterize
  // executes per refill.
  let resolveRun!: (r: { state: unknown; validity: Temporal.Duration; view: () => string }) => void;
  const pending = new Promise<
    { state: unknown; validity: Temporal.Duration; view: () => string }
  >((resolve) => {
    resolveRun = resolve;
  });
  const run = spy(() => pending);
  const identity = spy(() => Promise.resolve("flighted-id"));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([0xab])));
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer({ identity, rasterize }),
  });

  // Fire three polls concurrently. They all arrive while the Slot is
  // empty and Plugin.run is still hanging on the pending promise.
  const polls = [
    conductor.app.request("/api/display"),
    conductor.app.request("/api/display"),
    conductor.app.request("/api/display"),
  ];

  // Unblock the Plugin so the orchestration completes.
  resolveRun({ state: {}, validity: fiveMin, view: () => "<p>x</p>" });

  const bodies = await Promise.all(polls.map(async (p) => (await p).json()));

  // Each poll observed the same final identity from the shared refill.
  for (const body of bodies) {
    assertEquals(body.filename, "image-flighted-id");
  }
  // Plugin / Renderer fired exactly once across the three concurrent polls.
  assertSpyCalls(run, 1);
  assertSpyCalls(identity, 1);
  assertSpyCalls(rasterize, 1);
});

// ─── Error fallback: Plugin throw → error Bundle → Slot ────────────────────

Deno.test("Plugin throw → /api/display still answers 200 with the error-view filename and ~30s refresh_rate", async () => {
  const conductor = createConductor({
    ...defaults({
      errorView: (_err: Error) => "<p>ERR</p>",
      errorValidity: Temporal.Duration.from({ seconds: 30 }),
    }),
    pluginManager: managerFor({
      run: () => {
        throw new Error("plugin boom");
      },
    }),
    renderer: fakeRenderer(),
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  // The Slot contains the error Bundle, whose identity was computed from
  // the error view's HTML.
  assertEquals(body.filename, "image-id-<p>ERR</p>");
  // 30s validity → 30 (or 29 due to clock skew) refresh_rate.
  assertGreaterOrEqual(body.refresh_rate, 29);
  assertLessOrEqual(body.refresh_rate, 30);
});

Deno.test("Plugin throw → /image/<id>.png serves the error-view PNG bytes", async () => {
  const errPng = new Uint8Array([0xff, 0xee]);
  const conductor = createConductor({
    ...defaults({ errorView: (_err: Error) => "<p>ERR</p>" }),
    pluginManager: managerFor({
      run: () => {
        throw new Error("plugin boom");
      },
    }),
    renderer: fakeRenderer({ rasterize: () => Promise.resolve(errPng) }),
  });

  // Prime: the error-path refill lands an error Bundle into the Slot.
  const display = await (await conductor.app.request("/api/display")).json();
  const path = new URL(display.image_url).pathname;

  const res = await conductor.app.request(path);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), errPng);
});

// ─── /image/<id>.png ───────────────────────────────────────────────────────

Deno.test("GET /image/<id>.png returns the Slot's PNG bytes on identity match", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: fakeRenderer({
      identity: () => Promise.resolve("matchme"),
      rasterize: () => Promise.resolve(png),
    }),
  });

  // Prime the Slot via a poll first.
  await (await conductor.app.request("/api/display")).body?.cancel();

  const res = await conductor.app.request("/image/matchme.png");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), png);
});

Deno.test("GET /image/<id>.png returns 404 when id does not match the Slot's identity", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: fakeRenderer({ identity: () => Promise.resolve("matchme") }),
  });
  await (await conductor.app.request("/api/display")).body?.cancel();

  const res = await conductor.app.request("/image/something-else.png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /image/<id>.png returns 404 when the Slot is empty", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: fakeRenderer(),
  });

  // No /api/display poll yet — Slot is cold.
  const res = await conductor.app.request("/image/anything.png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

// ─── Tier 3: expired Slot triggers a fresh render ─────────────────────────

Deno.test("Tier 3: once validity has elapsed, the next /api/display runs the Plugin again and surfaces the new identity", async () => {
  // First poll cold-fills the Slot; the simulated clock then jumps past
  // `cachedAt + validity` so the next poll falls through to Tier 3.
  let clock = T0;
  const now = () => clock;
  let runCount = 0;
  const conductor = createConductor({
    ...defaults({ now, slot: createSlot({ now }) }),
    pluginManager: managerFor({
      run: () => {
        runCount++;
        return { state: { n: runCount }, validity: fiveMin, view: (s: { n: number }) => `<p>${s.n}</p>` };
      },
    }),
    renderer: fakeRenderer(),
  });

  const first = await (await conductor.app.request("/api/display")).json();
  clock = T0.add(Temporal.Duration.from({ minutes: 5 }));
  const second = await (await conductor.app.request("/api/display")).json();

  assertEquals(runCount, 2);
  // Different `state.n` → different `view(state)` → different identity.
  assertEquals(first.filename, "image-id-<p>1</p>");
  assertEquals(second.filename, "image-id-<p>2</p>");
});

// ─── Tier 1: validity hit reuses the Slot, no Plugin run ───────────────────

Deno.test("Tier 1: repeated /api/display polls within validity reuse the Slot — Plugin not invoked again", async () => {
  // The Slot's `display()` answers non-null while the entry's
  // `cachedAt + validity` is still in the future, so the second poll
  // must short-circuit before Plugin.run.
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const identity = spy(() => Promise.resolve("stable-id"));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([0x89])));
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({ run }),
    renderer: fakeRenderer({ identity, rasterize }),
  });

  const first = await (await conductor.app.request("/api/display")).json();
  const second = await (await conductor.app.request("/api/display")).json();
  const third = await (await conductor.app.request("/api/display")).json();

  // Identity is stable across all three polls.
  assertEquals(first.filename, "image-stable-id");
  assertEquals(second.filename, "image-stable-id");
  assertEquals(third.filename, "image-stable-id");
  // Plugin / Renderer ran exactly once — the Slot answered the rest.
  assertSpyCalls(run, 1);
  assertSpyCalls(identity, 1);
  assertSpyCalls(rasterize, 1);
});
