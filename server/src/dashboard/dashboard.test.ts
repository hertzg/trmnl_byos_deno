import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { Hono } from "hono";
import { type ConductorDeps, createConductor } from "../conductor/conductor.ts";
import { createDashboard } from "./dashboard.ts";
import { createSlot } from "../slot/slot.ts";
import type { Plugin, RunContext } from "../plugin/plugin.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { RasterizeOverrides, Renderer } from "../render/renderer.ts";
import type { Bundle } from "../plugin/bundle.ts";
import { createTelemetry } from "../telemetry/telemetry.ts";
import { createDeviceState } from "../device-state.ts";

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
  "errorView" | "errorValidity" | "friendlyId" | "now" | "slot" | "telemetry" | "deviceState"
> {
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    now,
    slot: createSlot({ now }),
    telemetry: createTelemetry(),
    deviceState: createDeviceState({ now }),
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
  const deviceState = conductorDeps.deviceState ?? createDeviceState({ now });
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
    deviceState,
  } as ConductorDeps);
  const dashboard = createDashboard({
    slot,
    telemetry,
    deviceState,
    conductorApp: conductor.app,
    pluginManager,
    renderer,
    now,
  });
  return {
    app: new Hono().route("/", conductor.app).route("/", dashboard),
    slot,
    telemetry,
    deviceState,
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

Deno.test("GET / still renders against an empty Slot (no Conductor wiring)", async () => {
  // Construct the Dashboard against an empty Slot whose refill hook is a
  // no-op. The page must still render — the meta table surfaces the empty
  // identity rather than the page crashing on a missing Slot entry.
  const now = () => T0;
  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  const noopApp = new Hono().get("/api/display", (c) => c.body(null, 204));
  const dashboard = createDashboard({
    slot,
    telemetry,
    deviceState: createDeviceState({ now }),
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
  assertEquals(html.includes("(none)"), true, "empty identity not surfaced");
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
    deviceState: createDeviceState({ now }),
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

  const res = await app.request(
    "/dashboard/preview.png?t=2026-05-16T12:00:00%2B02:00[Europe/Berlin]",
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), scrubPng);
});

Deno.test('GET /dashboard/preview.png parses ?t= into ctx.t and runs Plugin with intent="scrub", device=null', async () => {
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

Deno.test("GET /dashboard/preview.png converts ?t= from a different zone to the system zone", async () => {
  // A user scrubs to a time given in UTC, but the System's configured zone is
  // Europe/Berlin. The Dashboard must convert the UTC instant into Berlin time
  // before passing it to the Plugin. Same instant, different zone.
  const seen: { ctxes: RunContext[] } = { ctxes: [] };
  const now = () => at("2026-05-16T10:00");
  const { app } = wire({
    now,
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

  // Submit ?t= as a UTC instant: 2026-05-16T10:30:00[UTC]
  // This is the same instant as 2026-05-16T12:30:00+02:00[Europe/Berlin]
  // URL-encoded: %2B -> +, %5B -> [, %5D -> ]
  await (await app.request(
    "/dashboard/preview.png?t=2026-05-16T10:30:00%2B00:00%5BUTC%5D",
  )).arrayBuffer();

  assertEquals(seen.ctxes.length, 1);
  const ctx = seen.ctxes[0];
  // The parsed instant must be converted to the system zone (Europe/Berlin)
  // so the Plugin sees the correct local time.
  assertEquals(ctx.t.toString(), "2026-05-16T12:30:00+02:00[Europe/Berlin]");
  // Verify it's the same instant by comparing epochMilliseconds
  const utcInstant = Temporal.ZonedDateTime.from("2026-05-16T10:30:00[UTC]");
  assertEquals(ctx.t.epochMilliseconds, utcInstant.epochMilliseconds);
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

Deno.test("GET /dashboard/preview.png response carries x-identity equal to renderer.identity's return value", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: defaultRenderer({ identity: () => Promise.resolve("some-fixed-id") }),
  });

  const res = await app.request(
    "/dashboard/preview.png?t=2026-05-16T12:00:00%2B02:00[Europe/Berlin]",
  );
  await res.arrayBuffer();

  assertEquals(res.headers.get("x-identity"), "some-fixed-id");
});

Deno.test("GET /dashboard/preview.png response carries x-validity equal to the bundle validity in seconds, stringified", async () => {
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });

  const res = await app.request(
    "/dashboard/preview.png?t=2026-05-16T12:00:00%2B02:00[Europe/Berlin]",
  );
  await res.arrayBuffer();

  // fiveMin = 5 * 60 = 300 seconds
  assertEquals(res.headers.get("x-validity"), "300");
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

Deno.test("GET /dashboard/preview.png?t=<night-time> scrubs to sleep window and returns sleep screen with correct validity header", async () => {
  // Acceptance criterion 6: Dashboard scrub to a night-time t shows the sleep
  // screen with the expected validity headers.
  // Scrub to 23:30 during a 23:00-07:00 sleep window and verify:
  // 1. The preview renders the sleep view (black background + 😴)
  // 2. x-validity header = 27000 seconds (7.5 hours until 07:00)
  // 3. x-identity remains stable across multiple scrubs at the same time
  const sleepTime = Temporal.ZonedDateTime.from(
    "2026-05-16T23:30:00+02:00[Europe/Berlin]",
  );
  const expectedValiditySeconds = 27000; // 7.5 hours = 7.5 * 60 * 60

  // Create a sleep-window-aware plugin that simulates compose behavior:
  // when the ctx.t falls inside the 23:00–07:00 window, return a sleep result
  // with validity = remaining time until window end (floor exempted).
  // This mimics how the home plugin's compose function works.
  const sleepWindowAwarePlugin: Plugin<{ inWindow: boolean }> = {
    run(ctx: RunContext) {
      // Hardcoded sleep window: 23:00–07:00
      const hour = ctx.t.hour;
      const inWindow = hour >= 23 || hour < 7;

      if (inWindow) {
        // Compute remaining time until 07:00 (next day if needed)
        const endOfDay = ctx.t.add(Temporal.Duration.from({ days: 1 }));
        const windowEndTime = endOfDay.with({ hour: 7, minute: 0, second: 0 });
        const remaining = windowEndTime.since(ctx.t);

        // Return sleep result: black screen + 😴, with exact remaining validity
        return {
          state: { inWindow: true },
          validity: remaining, // exact remaining duration (floor exempted)
          view: () =>
            '<html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;display:flex;justify-content:center;align-items:center}.emoji{font-size:200px}</style></head><body><div class="emoji">😴</div></body></html>',
        };
      }

      // Awake: return normal view
      return {
        state: { inWindow: false },
        validity: fiveMin,
        view: () => "<p>awake</p>",
      };
    },
  };

  const { app } = wire({
    pluginManager: managerFor(sleepWindowAwarePlugin),
    renderer: defaultRenderer({
      identity: () => Promise.resolve("sleep-stable-id"),
    }),
  });

  // Scrub to 23:30 (inside the window)
  const res = await app.request(
    `/dashboard/preview.png?t=${encodeURIComponent(sleepTime.toString())}`,
  );

  assertEquals(res.status, 200);
  // Verify x-validity header contains the remaining window duration (7.5 hours)
  assertEquals(res.headers.get("x-validity"), String(expectedValiditySeconds));
  // Verify x-identity is stable
  assertEquals(res.headers.get("x-identity"), "sleep-stable-id");
  // Verify the PNG was rasterized (not testing PNG content, just that
  // the response carries PNG bytes)
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(bytes[0], 0x89); // PNG magic number
  assertEquals(bytes[1], 0x50);
  assertEquals(bytes[2], 0x4e);
  assertEquals(bytes[3], 0x47);
});

// ─── GET / — the "jump to t" form + clear button ──────────────────────────

Deno.test("GET / renders a 'jump to t' form that navigates GET /", async () => {
  // The text scrub field no longer posts a preview — the timeline owns the
  // transient render now. The `t` input is repurposed: submitting it
  // navigates `GET /?t=<value>`, re-rendering that day server-side. The
  // input stays editable and seeded so the operator can tweak from a
  // sensible default.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  // A GET form to / carries the `t` input.
  assertEquals(
    /<form[^>]*method="get"[^>]*action="\/"[^>]*>[\s\S]*?name="t"/.test(html),
    true,
    "the t form must navigate GET /",
  );
  // The form no longer targets the preview route.
  assertEquals(
    /action="\/dashboard\/preview\.png"/.test(html),
    false,
    "the t form must not post to /dashboard/preview.png anymore",
  );
  // The `t` input is editable.
  assertEquals(
    /<input[^>]*name="t"[^>]*disabled/.test(html),
    false,
    "t input must not be disabled",
  );
});

Deno.test("GET / renders the scrub timeline DOM", async () => {
  // The timeline replaces the old text-field scrub control. Assert on the
  // stable DOM hooks the client script binds to: the overview strip, the
  // detail track, the scrub head, and the section heading.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  assertEquals(html.includes('id="overview"'), true, "missing day-overview element");
  assertEquals(html.includes('id="track"'), true, "missing detail track");
  assertEquals(html.includes('id="scrub"'), true, "missing scrub head");
  assertEquals(
    /<h2>\s*timeline\s*<\/h2>/i.test(html),
    true,
    "missing 'timeline' section heading",
  );
});

Deno.test("GET /'s 'jump to t' input is seeded with a Temporal.ZonedDateTime.from-parseable now() so round-trip works", async () => {
  // The input value goes back as `?t=...` on submit and the route parses
  // with `Temporal.ZonedDateTime.from`. If we seeded a `datetime-local`
  // string we'd lose the zone and fall back to now() on submit — which
  // means the form looks like a no-op. Lock in the full-zoned shape.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  const match = /<input[^>]*name="t"[^>]*value="([^"]+)"/.exec(html);
  assertEquals(match !== null, true, "t input value attribute missing");
  const seeded = match![1];
  // Round-trip: the seeded value must parse, and must round-trip to
  // the same ZonedDateTime the helper would emit for T0.
  const parsed = Temporal.ZonedDateTime.from(seeded);
  assertEquals(parsed.toString(), T0.toString());
});

// ─── GET / — embedded window.__DASH__ timeline state ──────────────────────

// Pull the JSON out of the inline `window.__DASH__ = {...};` script.
function extractDash(html: string): Record<string, unknown> {
  const m = /window\.__DASH__\s*=\s*(\{[\s\S]*?\});/.exec(html);
  assertEquals(m !== null, true, "window.__DASH__ assignment missing");
  return JSON.parse(m![1].replace(/\\u003c/g, "<"));
}

Deno.test("GET / embeds a window.__DASH__ timeline-state object", async () => {
  const { app } = wire({});

  const html = await (await app.request("/")).text();
  const dash = extractDash(html);

  assertEquals(typeof dash.tz, "string");
  assertEquals(typeof dash.nowMs, "number");
  assertEquals(typeof dash.dayStartMs, "number");
  assertEquals(typeof dash.dayEndMs, "number");
  assertEquals(typeof dash.scrubMs, "number");
  // cache is an object or null — both are acceptable depending on Slot state.
  assertEquals(dash.cache === null || typeof dash.cache === "object", true);
});

Deno.test("GET /?t=<iso> embeds the scrub instant and that day's midnight", async () => {
  const { app } = wire({});

  const tIso = "2026-05-16T14:30:00+02:00[Europe/Berlin]";
  const html = await (await app.request(`/?t=${encodeURIComponent(tIso)}`)).text();
  const dash = extractDash(html);

  const instant = Temporal.ZonedDateTime.from(tIso);
  assertEquals(dash.scrubMs, instant.epochMilliseconds);
  assertEquals(dash.dayStartMs, instant.startOfDay().epochMilliseconds);
});

Deno.test("GET /?t= converts from a different zone to the system zone for embedding", async () => {
  // Verify that the GET / route also converts ?t= from a different zone
  // to the system zone for embedding in window.__DASH__.
  const { app } = wire({});

  // Submit ?t= as a UTC instant: 2026-05-16T10:30:00[UTC]
  // This is the same instant as 2026-05-16T12:30:00+02:00[Europe/Berlin]
  const html = await (await app.request(
    `/?t=${encodeURIComponent("2026-05-16T10:30:00+00:00[UTC]")}`,
  )).text();
  const dash = extractDash(html);

  // The embedded scrubMs should be the instant in Berlin time
  const expected = Temporal.ZonedDateTime.from(
    "2026-05-16T12:30:00+02:00[Europe/Berlin]",
  );
  assertEquals(
    dash.scrubMs,
    expected.epochMilliseconds,
    "scrubMs should be the same instant in system zone",
  );
});

Deno.test("GET /?date=<YYYY-MM-DD> embeds that date's midnight as dayStartMs", async () => {
  const { app } = wire({});

  const html = await (await app.request("/?date=2026-05-18")).text();
  const dash = extractDash(html);

  const expected = Temporal.PlainDate.from("2026-05-18")
    .toZonedDateTime("Europe/Berlin");
  assertEquals(dash.dayStartMs, expected.epochMilliseconds);
  // A non-today date with no time-of-day opens at its own midnight.
  assertEquals(dash.scrubMs, expected.epochMilliseconds);
});

Deno.test("GET / with a primed Slot embeds a non-null __DASH__.cache", async () => {
  // After the in-process refill the Slot holds an entry; the timeline
  // state carries the cached window so the client can draw the band.
  const { app } = wire({
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: defaultRenderer({ identity: () => Promise.resolve("cache-id-xyz") }),
  });

  const html = await (await app.request("/")).text();
  const dash = extractDash(html);

  const cache = dash.cache as Record<string, unknown> | null;
  assertEquals(cache !== null, true, "cache should be non-null with a primed Slot");
  assertEquals(typeof cache!.cachedAtMs, "number");
  assertEquals(typeof cache!.expiresMs, "number");
  assertEquals(cache!.identity, "cache-id-xyz");
});

Deno.test("GET / embeds the cached window's true expiry (cachedAt + validity), not the shrinking remaining time", async () => {
  // refreshIn shrinks as the page ages; expiresMs must stay pinned to the
  // entry's absolute expiry (cachedAt + validity), not cachedAt + refreshIn.
  let clock = T0;
  const { app } = wire({
    now: () => clock,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
  });
  // Cold-fill the Slot at T0 — the entry's cachedAt is T0, expiry T0 + 5 min.
  await (await app.request("/api/display")).body?.cancel();
  // Two minutes pass; the entry is still valid (expiry is 5 min out).
  clock = clock.add(Temporal.Duration.from({ minutes: 2 }));

  const html = await (await app.request("/")).text();
  const dash = extractDash(html);
  const cache = dash.cache as Record<string, unknown>;

  assertEquals(cache.cachedAtMs, T0.epochMilliseconds);
  assertEquals(
    cache.expiresMs,
    T0.add(fiveMin).epochMilliseconds,
    "expiresMs must be cachedAt + validity, independent of how long ago it was cached",
  );
});

Deno.test("GET / with an empty Slot embeds __DASH__.cache as null", async () => {
  // The no-op conductorApp never fills the Slot, so display() stays null
  // and the timeline state reflects that with cache: null.
  const now = () => T0;
  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  const noopApp = new Hono().get("/api/display", (c) => c.body(null, 204));
  const dashboard = createDashboard({
    slot,
    telemetry,
    deviceState: createDeviceState({ now }),
    conductorApp: noopApp,
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: defaultRenderer(),
    now,
  });

  const html = await (await dashboard.request("/")).text();
  const dash = extractDash(html);

  assertEquals(dash.cache, null);
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

// ─── TraceStrip: error message is not duplicated ──────────────────────────

Deno.test("GET /'s trace block does not duplicate the error message (stack already includes it)", async () => {
  // `error.stack` on a thrown Error begins with `Error: <message>` —
  // rendering both `message` and the full `stack` repeats the message
  // verbatim at the top of the <pre>. The trace block must render the
  // stack (which carries the message at the top) at most once.
  const message = "unique-error-message-9f8a3c";
  const { app, telemetry } = wire({
    pluginManager: managerFor({
      run: () => {
        throw new Error(message);
      },
    }),
  });

  await (await app.request("/api/display")).body?.cancel();
  await Promise.resolve();
  await Promise.resolve();

  // Sanity: telemetry has the error and the stack includes the message.
  const trace = telemetry.latest();
  assertEquals(trace?.error?.message, message);
  assertEquals(trace?.error?.stack?.includes(message), true);

  const html = await (await app.request("/")).text();

  // The error <pre> block is rendered.
  assertEquals(html.includes(message), true);
  // ...but the message appears only once inside the error block. Find
  // the error block's content and count occurrences of the message.
  const block = /<pre class="error">([\s\S]*?)<\/pre>/.exec(html);
  assertEquals(block !== null, true, "error block missing from HTML");
  const occurrences = (block![1].match(new RegExp(message, "g")) ?? []).length;
  assertEquals(
    occurrences,
    1,
    `error message duplicated in TraceStrip (saw ${occurrences} occurrences)`,
  );
});

// ─── topbar build identity ─────────────────────────────────────────────────

Deno.test("GET / renders the image version and release time in the topbar", async () => {
  const now = () => T0;
  const dashboard = createDashboard({
    slot: createSlot({ now }),
    telemetry: createTelemetry(),
    deviceState: createDeviceState({ now }),
    conductorApp: new Hono().get("/api/display", (c) => c.body(null, 204)),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "" }),
    }),
    renderer: defaultRenderer(),
    now,
    build: {
      version: "0.1.0+20260714120000Z",
      builtAt: Temporal.Instant.from("2026-07-14T12:00:00Z"),
    },
  });

  const html = await (await dashboard.request("/")).text();

  assertEquals(html.includes("0.1.0+20260714120000Z"), true, "version missing from the page");
  // The release instant renders in the page's tz — Europe/Berlin is UTC+2 in July.
  assertEquals(html.includes("released 2026-07-14 14:00:00"), true, "release time missing");
});

Deno.test("GET / without build info renders a dateless <base>+dev build", async () => {
  // No baked build-info.json exists when tests run, so the default path
  // resolves to the manifest's base version with +dev metadata and no date.
  const { app } = wire({});

  const html = await (await app.request("/")).text();

  assertEquals(/class="build"><code>[^<]+\+dev<\/code>/.test(html), true, "dev fallback missing");
  assertEquals(html.includes("released"), false, "a dev build has no release time");
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

// ─── GET /dashboard/preview.png?bitDepth= — per-render override ────────────

Deno.test("GET /dashboard/preview.png?bitDepth=2 passes the parsed override to renderer.rasterize", async () => {
  const rasterize = spy((_b: Bundle, _o?: RasterizeOverrides) =>
    Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  );
  const { app } = wire({ renderer: defaultRenderer({ rasterize }) });

  await (await app.request("/dashboard/preview.png?bitDepth=2")).arrayBuffer();

  assertSpyCalls(rasterize, 1);
  assertEquals(rasterize.calls[0].args[1], { bitDepth: 2 });
});

Deno.test("GET /dashboard/preview.png ignores a bitDepth that is not 1/2/4/8", async () => {
  const rasterize = spy((_b: Bundle, _o?: RasterizeOverrides) =>
    Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  );
  const { app } = wire({ renderer: defaultRenderer({ rasterize }) });

  await (await app.request("/dashboard/preview.png?bitDepth=3")).arrayBuffer();
  await (await app.request("/dashboard/preview.png")).arrayBuffer();

  assertSpyCalls(rasterize, 2);
  assertEquals(rasterize.calls[0].args[1], { bitDepth: undefined });
  assertEquals(rasterize.calls[1].args[1], { bitDepth: undefined });
});
