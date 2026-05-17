import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { Hono } from "hono";
import { type ConductorDeps, createConductor } from "../conductor/conductor.ts";
import { createDashboard, type DashboardDeps } from "./dashboard.ts";
import type { Result, RunContext } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });
const INTERNAL = "http://internal:3000";

function conductorDefaults(
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

// Compose the Conductor's HTTP sub-app and the Dashboard the same way main.ts
// does. Tests that exercise both /api/* and /preview* go through this wiring
// so they see the same composition the production server does.
function wire(
  conductorDeps: Partial<ConductorDeps>,
  dashboardOverrides: Partial<DashboardDeps> = {},
) {
  const conductor = createConductor({
    ...conductorDefaults(conductorDeps),
    ...conductorDeps,
  } as ConductorDeps);
  const dashboard = createDashboard({
    derive: conductor.derive,
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array([0x89])),
    internalOrigin: INTERNAL,
    now: conductorDeps.now ?? conductorDefaults().now,
    ...dashboardOverrides,
  });
  return new Hono().route("/", conductor.app).route("/", dashboard);
}

// ─── dashboard at / ────────────────────────────────────────────────────────

Deno.test("GET / returns 200 with an HTML dashboard page", async () => {
  const app = wire({
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "x",
  });

  const res = await app.request("/");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  await res.body?.cancel();
});

Deno.test("GET / runs the Plugin with intent=scrub", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));

  const app = wire({
    plugin: { run },
    deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
    identityFor: (html) => `id-${html}`,
  });

  await (await app.request("/")).body?.cancel();

  assertEquals(run.calls.at(-1)?.args[0].intent, "scrub");
});

Deno.test("GET / defaults t to now when no ?t= is supplied", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const app = wire({
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  await (await app.request("/")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].t.toString(), T0.toString());
});

Deno.test("GET /?t=<future> scrubs the Plugin at the supplied t", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const app = wire({
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  const tFuture = T0.add({ minutes: 30 });
  await (await app.request("/?t=2026-05-16T10:30")).body?.cancel();

  assertEquals(run.calls.at(-1)?.args[0].t.toString(), tFuture.toString());
});

Deno.test("GET /?t=<garbage> shows a parse-error notice and falls back to default", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const app = wire({
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  const res = await app.request("/?t=not-a-date");

  assertEquals(res.status, 200, "should not 500 on bad input");
  const html = await res.text();
  assertEquals(html.toLowerCase().includes("could not parse"), true);
  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].t.toString(), T0.toString());
});

Deno.test("GET / renders pipeline timings: per-step bar + total re-render", async () => {
  const app = wire({
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  const html = await (await app.request("/")).text();

  assertEquals(html.includes(">run</div>"), true, "run row missing");
  assertEquals(html.includes(">deriveHtml</div>"), true, "deriveHtml row missing");
  assertEquals(html.includes(">identityFor</div>"), true, "identityFor row missing");
  assertEquals(html.includes(">rasterize</div>"), true, "rasterize row missing");
  assertEquals(html.includes("re-render:"), true, "total re-render line missing");
});

Deno.test("GET / surfaces ctx.device in the metadata table once a Device has polled", async () => {
  const app = wire({
    plugin: {
      run: (ctx: RunContext) => ({
        state: { seen: ctx.device?.id ?? null },
        validity: fiveMin,
        view: () => "<p>x</p>",
      }),
    },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  await (await app.request("/api/display", { headers: { id: "AA:BB:CC" } })).body?.cancel();

  const html = await (await app.request("/")).text();

  assertEquals(html.includes("device"), true, "device row missing");
  assertEquals(html.includes("AA:BB:CC"), true, "device id missing");
});

Deno.test("GET / renders the rendered Image, the scrubber, and Result metadata", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const app = wire(
    {
      plugin: {
        run: () => ({
          state: { msg: "hello" },
          validity: Temporal.Duration.from({ minutes: 7 }),
          view: function MyPluginView(s: { msg: string }) {
            return `<p>${s.msg}</p>`;
          },
        }),
      },
      deriveHtml: (r: Result<{ msg: string }>) => String(r.view(r.state)),
      identityFor: () => "dashid",
    },
    { fetchPngFromUrl: () => Promise.resolve(png) },
  );

  const html = await (await app.request("/")).text();

  const b64 = "iVBORw==";
  assertEquals(html.includes(`data:image/png;base64,${b64}`), true, "PNG data URL missing");
  assertEquals(html.includes('name="t"'), true, "scrubber input missing");
  assertEquals(html.includes('type="datetime-local"'), true, "datetime-local input missing");
  assertEquals(html.includes("7m"), true, "validity duration missing");
  assertEquals(html.includes("MyPluginView"), true, "view identity missing");
  assertEquals(html.includes("dashid"), true, "image identity missing");
  assertEquals(html.includes("2026-05-16T10:00"), true, "chosen t missing");
});

Deno.test("GET / renders the Plugin's Result.state as JSON for debugging", async () => {
  const app = wire({
    plugin: {
      run: () => ({
        state: { departures: [{ line: "U7", at: "10:05" }], count: 1 },
        validity: fiveMin,
        view: () => "<p>x</p>",
      }),
    },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  const decoded = (await (await app.request("/")).text()).replaceAll("&quot;", '"');

  assertEquals(decoded.includes('"line"'), true, "state JSON key missing");
  assertEquals(decoded.includes('"U7"'), true, "state JSON value missing");
  assertEquals(decoded.includes('"count": 1'), true, "state JSON pretty-printed");
});

Deno.test("GET / degrades gracefully when fetchPngFromUrl throws (e.g. CDP down)", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.reject(new Error("CDP /json/version 502")));
  const app = wire(
    {
      plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
      deriveHtml: () => "<p>x</p>",
      identityFor: () => "id",
    },
    { fetchPngFromUrl },
  );

  const res = await app.request("/");

  // Page still renders — scrubber, Result metadata, timings all stay
  // useful for debugging while CDP is down.
  assertEquals(res.status, 200);
  const html = await res.text();
  assertEquals(html.includes("rasterize failed"), true, "missing degraded notice");
  assertEquals(html.includes("CDP /json/version 502"), true, "missing error detail");
  // The inline <img> is omitted when there's no PNG.
  assertEquals(html.includes("data:image/png;base64,"), false, "should not embed empty image");
  // Metadata still present.
  assertEquals(html.includes("identity"), true, "metadata table missing");
});

Deno.test("GET / fetches the inlined PNG via fetchPngFromUrl pointed at the internal origin's /preview", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const app = wire(
    {
      plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
      deriveHtml: () => "<p>x</p>",
      identityFor: () => "id",
    },
    { fetchPngFromUrl },
  );

  await (await app.request("/?t=2026-05-16T11:00")).body?.cancel();

  assertSpyCalls(fetchPngFromUrl, 1);
  const url = fetchPngFromUrl.calls[0].args[0];
  assertEquals(url.startsWith(INTERNAL), true, `url ${url} should start with ${INTERNAL}`);
  assertEquals(url.includes("/preview?"), true, "url should hit /preview with a query");
  assertEquals(url.includes("t=2026-05-16T11%3A00"), true, "url should carry the scrub t");
});

// ─── /preview ──────────────────────────────────────────────────────────────

Deno.test("GET /preview returns the live HTML at t=now and intent=scrub by default", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent, at: ctx.t.toString() },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));

  const app = wire({
    plugin: { run },
    deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
    identityFor: (html) => `id-${html}`,
  });

  const preview = await app.request("/preview");
  assertEquals(preview.status, 200);
  assertEquals(preview.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(await preview.text(), "<p>scrub</p>");
  assertEquals(run.calls.at(-1)?.args[0].intent, "scrub");
  assertEquals(run.calls.at(-1)?.args[0].t.toString(), T0.toString());
});

Deno.test("GET /preview honors ?t= and ?intent= so /preview/png can forward them through to CDP", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent, at: ctx.t.toString() },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const app = wire({
    plugin: { run },
    deriveHtml: () => "<p>x</p>",
    identityFor: () => "id",
  });

  await (await app.request("/preview?t=2026-05-16T11:00&intent=poll")).body?.cancel();

  const call = run.calls.at(-1)!;
  assertEquals(call.args[0].intent, "poll");
  assertEquals(call.args[0].t.toString(), at("2026-05-16T11:00").toString());
});

Deno.test("GET /preview returns status 500 with the error view HTML when the Plugin throws", async () => {
  const boom = new Error("plugin boom");
  const app = wire({
    plugin: {
      run: () => {
        throw boom;
      },
    },
    deriveHtml: (r: Result<unknown>) => String(r.view(r.state)),
    identityFor: () => "id",
    errorView: (err: Error) => `<html><body>ERR: ${err.message}</body></html>`,
  });

  const res = await app.request("/preview");

  assertEquals(res.status, 500);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assertEquals(body.includes("plugin boom"), true, "error message missing from body");
});

// ─── /preview/png ──────────────────────────────────────────────────────────

Deno.test("GET /preview/png returns the bytes fetchPngFromUrl resolved with", async () => {
  const png = new Uint8Array([0xbb]);
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(png));
  const app = wire(
    {
      plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
      deriveHtml: () => "<p>x</p>",
      identityFor: () => "id",
    },
    { fetchPngFromUrl },
  );

  const res = await app.request("/preview/png");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "image/png");
  assertEquals(res.headers.get("cache-control"), "no-store");
  assertEquals(new Uint8Array(await res.arrayBuffer()), png);
});

Deno.test("GET /preview/png hands CDP the internalOrigin /preview URL", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const app = wire(
    {
      plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
      deriveHtml: () => "<p>x</p>",
      identityFor: () => "id",
    },
    { fetchPngFromUrl },
  );

  await (await app.request("/preview/png")).body?.cancel();

  assertSpyCalls(fetchPngFromUrl, 1);
  assertEquals(fetchPngFromUrl.calls[0].args[0], `${INTERNAL}/preview`);
});

Deno.test("GET /preview/png?t=...&intent=... forwards the query through to /preview via CDP", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const app = wire(
    {
      plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
      deriveHtml: () => "<p>x</p>",
      identityFor: () => "id",
    },
    { fetchPngFromUrl },
  );

  await (await app.request("/preview/png?t=2026-05-16T11:00&intent=poll")).body?.cancel();

  const url = fetchPngFromUrl.calls[0].args[0];
  assertEquals(url.startsWith(`${INTERNAL}/preview?`), true);
  assertEquals(url.includes("t=2026-05-16T11%3A00"), true);
  assertEquals(url.includes("intent=poll"), true);
});
