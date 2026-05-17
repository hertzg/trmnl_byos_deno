import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { Hono } from "hono";
import { type ConductorDeps, createConductor } from "../conductor/conductor.ts";
import { createDashboard } from "./dashboard.ts";
import { createSlot } from "../slot/slot.ts";
import type { Plugin } from "../plugin/plugin.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Bundle } from "../plugin/bundle.ts";
import { createTelemetry } from "../telemetry/telemetry.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

function managerFor(plugin: Plugin<unknown>): PluginManager {
  return {
    async run(ctx) {
      const result = await plugin.run(ctx);
      return { result, assets: {} };
    },
  };
}

function defaultRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    identity: (b: Bundle) => Promise.resolve("id-" + String(b.result.view(b.result.state))),
    rasterize: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    origin: () => "http://127.0.0.1:0",
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function conductorDefaults(
  now: () => Temporal.ZonedDateTime,
  overrides: Partial<ConductorDeps> = {},
): Pick<
  ConductorDeps,
  "errorView" | "errorValidity" | "friendlyId" | "now" | "slot" | "telemetry"
> {
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    now,
    slot: createSlot({ now }),
    telemetry: createTelemetry(),
    ...overrides,
  };
}

// Compose the Conductor's HTTP sub-app and the Dashboard the way main.ts
// does. Both sub-apps share the same Slot + Telemetry so a Conductor
// refill is observable from the Dashboard's in-process read.
function wire(conductorDeps: Partial<ConductorDeps>) {
  const now = conductorDeps.now ?? (() => T0);
  const slot = conductorDeps.slot ?? createSlot({ now });
  const telemetry = conductorDeps.telemetry ?? createTelemetry();
  const renderer = conductorDeps.renderer ?? defaultRenderer();
  const conductor = createConductor({
    ...conductorDefaults(now),
    ...conductorDeps,
    renderer,
    slot,
    telemetry,
  } as ConductorDeps);
  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: conductor.app,
    now,
  });
  return {
    app: new Hono().route("/", conductor.app).route("/", dashboard),
    slot,
    telemetry,
  };
}

// ─── dashboard at / ────────────────────────────────────────────────────────

Deno.test("GET / returns 200 with an HTML dashboard page", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });

  const res = await app.request("/");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  await res.body?.cancel();
});

Deno.test("GET / triggers a refill via /api/display when the Slot is empty", async () => {
  // First request: Slot empty, Dashboard pulls /api/display in-process,
  // Conductor runs Plugin once. Second request: Slot still valid, Plugin
  // not called again. The spy reflects exactly one Plugin run total.
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const { app } = wire({ pluginManager: managerFor({ run }) });

  await (await app.request("/")).body?.cancel();
  await (await app.request("/")).body?.cancel();

  assertSpyCalls(run, 1);
});

Deno.test("GET / embeds <img src=/image/<identity>.png> referencing the Slot's current identity", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: defaultRenderer({ identity: () => Promise.resolve("dashid-aaa") }),
  });

  const html = await (await app.request("/")).text();

  assertEquals(html.includes('src="/image/dashid-aaa.png"'), true, "image src missing");
});

Deno.test("GET / surfaces a notice when the Slot stays empty (no Conductor wiring)", async () => {
  // Construct the Dashboard against an empty Slot whose refill hook is a
  // no-op. The page must still render — surfacing the empty state through
  // a notice instead of trying to embed a broken /image URL.
  const now = () => T0;
  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  const noopApp = new Hono().get("/api/display", (c) => c.body(null, 204));
  const dashboard = createDashboard({ slot, telemetry, conductorApp: noopApp, now });

  const res = await dashboard.request("/");

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes("Slot is empty"), true, "missing empty-slot notice");
  assertEquals(html.includes("data:image/png"), false, "should not embed an image");
});

// ─── Dashboard reads telemetry.latest() to render the trace ─────────────

Deno.test("GET / renders the trace block populated from telemetry.latest()", async () => {
  // After a real /api/display cycle the trace is in telemetry. The
  // Dashboard reads `latest()` and surfaces identity, ranAt, durations,
  // and the error state.
  const { app, telemetry } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: defaultRenderer({ identity: () => Promise.resolve("trace-id") }),
  });

  // Cold-fill the Slot (also records the trace through the rasterize
  // .finally). The Dashboard's GET / further down will read latest().
  await (await app.request("/api/display")).body?.cancel();
  await Promise.resolve();
  await Promise.resolve();

  const html = await (await app.request("/")).text();

  // Sanity: telemetry actually has a trace.
  const trace = telemetry.latest();
  assertEquals(trace?.identity, "trace-id");
  // The trace strip surfaces identity + the three duration labels and
  // does not surface an error line on a successful cycle. The successful
  // path renders no <pre class="error"> block.
  assertEquals(html.includes("trace-id"), true, "missing trace identity");
  assertEquals(html.includes("plugin run"), true, "missing pluginRun label");
  assertEquals(html.includes("identity"), true, "missing identity label");
  assertEquals(html.includes("rasterize"), true, "missing rasterize label");
  assertEquals(html.includes('class="error"'), false, "error block should be absent on success");
});

Deno.test("GET / renders a placeholder trace block when telemetry.latest() is null", async () => {
  // Before any cycle has run, telemetry is empty. The Dashboard must
  // not crash — it shows a "no cycle yet" placeholder. The test wires
  // the Dashboard alone (no Conductor cold-fill) so the Slot fills
  // but telemetry does NOT (the no-op conductorApp doesn't run the
  // Conductor's orchestration, so no record happens).
  const now = () => T0;
  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  const noopApp = new Hono().get("/api/display", (c) => c.body(null, 204));
  const dashboard = createDashboard({ slot, telemetry, conductorApp: noopApp, now });

  const res = await dashboard.request("/");

  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(telemetry.latest(), null);
  // Some placeholder copy must be present — "no trace" or similar.
  assertEquals(
    /no.*(trace|cycle)/i.test(html),
    true,
    "expected a 'no trace yet' placeholder",
  );
});

Deno.test("GET / renders the trace's error message when the last cycle failed", async () => {
  // Plugin throws → trace.error is the caught Error. The Dashboard
  // surfaces the message so the operator can see what went wrong
  // without consulting logs.
  const { app, telemetry } = wire({
    pluginManager: managerFor({
      run: () => {
        throw new Error("plugin exploded — dashboard should show this");
      },
    }),
  });

  await (await app.request("/api/display")).body?.cancel();
  await Promise.resolve();
  await Promise.resolve();

  const html = await (await app.request("/")).text();

  assertEquals(telemetry.latest()?.error?.message, "plugin exploded — dashboard should show this");
  assertEquals(
    html.includes("plugin exploded"),
    true,
    "trace block should surface the error message",
  );
});

// ─── /preview/png removed ──────────────────────────────────────────────────

Deno.test("GET /preview/png returns 404 — the render path is /image/<id>.png on the Conductor", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });

  const res = await app.request("/preview/png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});

Deno.test("GET /preview returns 404 — no public HTML route", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });

  const res = await app.request("/preview");
  await res.body?.cancel();

  assertEquals(res.status, 404);
});
