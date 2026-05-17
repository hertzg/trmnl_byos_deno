import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { Hono } from "hono";
import { type ConductorDeps, createConductor } from "../conductor/conductor.ts";
import { createDashboard } from "./dashboard.ts";
import { createSlot } from "../slot/slot.ts";
import type { Plugin, RunContext } from "../plugin/plugin.ts";
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
// refill is observable from the Dashboard's in-process read. The Dashboard
// also gets the PluginManager + Renderer it needs for the scrub path.
function wire(conductorDeps: Partial<ConductorDeps>) {
  const now = conductorDeps.now ?? (() => T0);
  const slot = conductorDeps.slot ?? createSlot({ now });
  const telemetry = conductorDeps.telemetry ?? createTelemetry();
  const renderer = conductorDeps.renderer ?? defaultRenderer();
  const pluginManager = conductorDeps.pluginManager ?? managerFor({
    run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
  });
  const conductor = createConductor({
    ...conductorDefaults(now),
    ...conductorDeps,
    pluginManager,
    renderer,
    slot,
    telemetry,
  } as ConductorDeps);
  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: conductor.app,
    pluginManager,
    renderer,
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
  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: noopApp,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: defaultRenderer(),
    now,
  });

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
  assertEquals(html.includes("identity hash"), true, "missing identity-duration label");
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
  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: noopApp,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: defaultRenderer(),
    now,
  });

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

// ─── GET /dashboard/preview.png — transient scrub render ──────────────────

Deno.test("GET /dashboard/preview.png?t=... runs PluginManager + Renderer.rasterize and returns the PNG bytes with content-type image/png", async () => {
  // The scrub path bypasses the Slot: it calls PluginManager.run with a
  // fresh RunContext using the parsed `t`, then Renderer.rasterize on the
  // returned Bundle, and streams the bytes back as image/png. Single render
  // path, no caching.
  const scrubPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad]);
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>scrub</p>" }),
    }),
    renderer: defaultRenderer({ rasterize: () => Promise.resolve(scrubPng) }),
  });

  const res = await app.request("/dashboard/preview.png?t=2026-05-16T12:00:00%2B02:00[Europe/Berlin]");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), scrubPng);
});

Deno.test("GET /dashboard/preview.png parses ?t= into ctx.t and runs Plugin with intent=\"scrub\", device=null", async () => {
  // The scrub form posts a fully-zoned ISO string; the Dashboard parses it
  // with Temporal.ZonedDateTime.from and threads it onto the RunContext.
  // intent is "scrub" (so Plugins can differentiate dashboard previews
  // from real Device polls) and device is null (Dashboard has no access
  // to the Conductor's private latestDevice — the scrub is not a Device
  // interaction).
  const seen: { ctxes: RunContext[] } = { ctxes: [] };
  const { app } = wire({
    pluginManager: {
      run(ctx) {
        seen.ctxes.push(ctx);
        return Promise.resolve({
          result: { state: {}, validity: fiveMin, view: () => "" },
          assets: {},
        });
      },
    },
  });

  await (await app.request(
    "/dashboard/preview.png?t=2026-05-16T12:30:00%2B02:00[Europe/Berlin]",
  )).arrayBuffer();

  assertEquals(seen.ctxes.length, 1);
  const ctx = seen.ctxes[0];
  assertEquals(ctx.intent, "scrub");
  assertEquals(ctx.device, null);
  assertEquals(ctx.t.toString(), "2026-05-16T12:30:00+02:00[Europe/Berlin]");
});

Deno.test("GET /dashboard/preview.png falls back to now() when ?t is missing or unparseable", async () => {
  // Robustness: the form always supplies `t`, but the route guards against
  // missing or malformed values so a typo in the URL doesn't 500.
  const seen: { ts: Temporal.ZonedDateTime[] } = { ts: [] };
  const { app } = wire({
    pluginManager: {
      run(ctx) {
        seen.ts.push(ctx.t);
        return Promise.resolve({
          result: { state: {}, validity: fiveMin, view: () => "" },
          assets: {},
        });
      },
    },
  });

  await (await app.request("/dashboard/preview.png")).arrayBuffer();
  await (await app.request("/dashboard/preview.png?t=not-a-date")).arrayBuffer();

  assertEquals(seen.ts.length, 2);
  // Both fall back to T0 (the wire helper's clock).
  assertEquals(seen.ts[0].toString(), T0.toString());
  assertEquals(seen.ts[1].toString(), T0.toString());
});

Deno.test("GET /dashboard/preview.png does NOT mutate the Slot or write to Telemetry", async () => {
  // ADR-0003: scrub bypasses the Slot and does not record to Telemetry.
  // Spy on slot.put / slot.clear / telemetry.record and assert each stays
  // at zero calls across a scrub. The Slot's pre-scrub identity must
  // survive untouched, even though the scrub Bundle would normally hash
  // to a different identity.
  const now = () => T0;
  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  const slotPut = spy(slot, "put");
  const slotClear = spy(slot, "clear");
  const telemetryRecord = spy(telemetry, "record");
  // Prime the Slot with a known entry (via the Conductor's normal path)
  // so we can prove the scrub leaves it alone.
  const { app } = wire({
    slot,
    telemetry,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>cached</p>" }),
    }),
    renderer: defaultRenderer({ identity: () => Promise.resolve("cached-id") }),
  });
  await (await app.request("/api/display")).body?.cancel();
  await Promise.resolve();
  await Promise.resolve();
  // Sanity: the Conductor's cold-fill put the entry and recorded the trace.
  // We snapshot the call counts so the scrub-only delta is unambiguous.
  const putBefore = slotPut.calls.length;
  const clearBefore = slotClear.calls.length;
  const recordBefore = telemetryRecord.calls.length;
  const identityBefore = slot.display()?.identity;

  const res = await app.request(
    "/dashboard/preview.png?t=2026-05-16T12:00:00%2B02:00[Europe/Berlin]",
  );
  await res.arrayBuffer();
  await Promise.resolve();
  await Promise.resolve();

  // The scrub adds zero new put/clear/record calls.
  assertEquals(slotPut.calls.length, putBefore, "scrub must not call slot.put");
  assertEquals(slotClear.calls.length, clearBefore, "scrub must not call slot.clear");
  assertEquals(
    telemetryRecord.calls.length,
    recordBefore,
    "scrub must not call telemetry.record",
  );
  // The Slot's identity is unchanged — same Image still cached.
  assertEquals(slot.display()?.identity, identityBefore);
});

// ─── GET / — enabled scrub form + clear button ────────────────────────────

Deno.test("GET / renders an enabled scrub form that posts to /dashboard/preview.png", async () => {
  // The form's action is /dashboard/preview.png (GET, so the browser can
  // embed the result as an <img> or open it directly). The `t` input is
  // editable (not `disabled`) and seeded with the current `now()` so the
  // operator can tweak from a sensible default.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  // Form action points at the scrub route.
  assertEquals(
    /<form[^>]*action="\/dashboard\/preview\.png"/.test(html),
    true,
    "scrub form must post to /dashboard/preview.png",
  );
  // The `t` input is editable.
  assertEquals(
    /<input[^>]*name="t"[^>]*disabled/.test(html),
    false,
    "scrub input must not be disabled",
  );
  // The submit button is editable.
  assertEquals(
    /<button[^>]*type="submit"[^>]*disabled/.test(html),
    false,
    "scrub button must not be disabled",
  );
  // No deferred-scrub placeholder copy on the page.
  assertEquals(
    /deferred to a later slice/.test(html),
    false,
    "deferred-placeholder copy should be gone",
  );
});

Deno.test("GET /'s scrub input is seeded with a Temporal.ZonedDateTime.from-parseable now() so round-trip works", async () => {
  // The form value goes back as `?t=...` on submit and the route parses
  // with `Temporal.ZonedDateTime.from`. If we seeded a `datetime-local`
  // string we'd lose the zone and fall back to now() on submit — which
  // means the form looks like a no-op. Lock in the full-zoned shape.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  const match = /<input[^>]*name="t"[^>]*value="([^"]+)"/.exec(html);
  assertEquals(match !== null, true, "scrub input value attribute missing");
  const seeded = match![1];
  // Round-trip: the seeded value must parse, and must round-trip to
  // the same ZonedDateTime the helper would emit for T0.
  const parsed = Temporal.ZonedDateTime.from(seeded);
  assertEquals(parsed.toString(), T0.toString());
});

Deno.test("GET / renders a clear-cache form that POSTs to /dashboard/clear", async () => {
  // The clear button is its own form (POST, no body) so the browser turns
  // it into a real state-changing request — not a navigation that GETs.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  assertEquals(
    /<form[^>]*method="post"[^>]*action="\/dashboard\/clear"/i.test(html) ||
      /<form[^>]*action="\/dashboard\/clear"[^>]*method="post"/i.test(html),
    true,
    "clear button must be a POST form to /dashboard/clear",
  );
});

// ─── POST /dashboard/clear — invalidate Slot ──────────────────────────────

Deno.test("POST /dashboard/clear calls slot.clear() and redirects 303 to /", async () => {
  const now = () => T0;
  const slot = createSlot({ now });
  const slotClear = spy(slot, "clear");
  const { app } = wire({
    slot,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });

  const res = await app.request("/dashboard/clear", { method: "POST" });
  await res.body?.cancel();

  assertEquals(res.status, 303);
  assertEquals(res.headers.get("location"), "/");
  assertSpyCalls(slotClear, 1);
});

Deno.test("POST /dashboard/clear invalidates the Slot — subsequent /api/display refills", async () => {
  // End-to-end: after clear, the next /api/display must run the Plugin
  // again because the Slot is cold. Identity must change accordingly.
  let runCount = 0;
  const { app } = wire({
    pluginManager: managerFor({
      run: () => {
        runCount++;
        return {
          state: { n: runCount },
          validity: fiveMin,
          view: (s: { n: number }) => `<p>${s.n}</p>`,
        };
      },
    }),
  });

  // Cold-fill.
  const first = await (await app.request("/api/display")).json();
  assertEquals(runCount, 1);
  // Clear.
  await (await app.request("/dashboard/clear", { method: "POST" })).body?.cancel();
  // Next /api/display runs the Plugin again — Slot is empty.
  const second = await (await app.request("/api/display")).json();

  assertEquals(runCount, 2);
  // Different `state.n` → different view output → different identity.
  assertEquals(first.filename === second.filename, false);
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
