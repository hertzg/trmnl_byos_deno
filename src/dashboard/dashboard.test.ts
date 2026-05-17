import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { Hono } from "hono";
import { type ConductorDeps, createConductor } from "../conductor/conductor.ts";
import { createDashboard } from "./dashboard.ts";
import type { Result, RunContext } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

// Mutable clock so tests can advance time between requests.
function clock(initial: Temporal.ZonedDateTime = T0) {
  let now = initial;
  return {
    now: () => now,
    advance(by: Temporal.DurationLike) {
      now = now.add(by);
    },
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

// Compose the Conductor's HTTP sub-app and the Dashboard the same way
// main.ts does. The "doesn't mutate Current state" tests need both, so
// every test uses the same wiring for consistency.
function wire(deps: Partial<ConductorDeps>) {
  const conductor = createConductor({ ...defaults(deps), ...deps } as ConductorDeps);
  const dashboard = createDashboard({
    derive: conductor.derive,
    render: conductor.render,
    committedState: conductor.committedState,
    now: deps.now ?? defaults().now,
  });
  return new Hono().route("/", conductor.app).route("/", dashboard);
}

Deno.test("GET / returns 200 with an HTML dashboard page", async () => {
  const app = wire({
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x89])),
    },
    identityFor: () => "x",
  });

  const res = await app.request("/");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type")?.startsWith("text/html"), true);
  await res.body?.cancel();
});

Deno.test("GET / runs the Plugin with intent=scrub and does not mutate Current Result/Image", async () => {
  const c = clock();
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([0xaa])));

  const app = wire({
    now: c.now,
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: (html) => `id-${html}`,
  });

  // Prime Current state with a real poll.
  const firstPoll = await (await app.request("/api/display")).json();
  assertSpyCalls(rasterize, 1);

  // Dashboard scrubs.
  await (await app.request("/")).body?.cancel();

  // The dashboard's run was a scrub.
  assertEquals(run.calls.at(-1)?.args[0].intent, "scrub");

  // Inside the original validity window, /api/display still serves the
  // poll's image — Current state untouched.
  c.advance({ minutes: 1 });
  const secondPoll = await (await app.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
});

Deno.test("GET / defaults t to the Current Result's commit moment when one exists", async () => {
  const c = clock();
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const app = wire({
    now: c.now,
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Poll at T0 → Current Result committed at T0.
  await (await app.request("/api/display")).body?.cancel();
  await (await app.request("/")).body?.cancel();

  const scrubCall = run.calls.at(-1)!;
  assertEquals(scrubCall.args[0].intent, "scrub");
  assertEquals(scrubCall.args[0].t.toString(), T0.toString());
});

Deno.test("GET / defaults t to now when no Current Result exists", async () => {
  const c = clock();
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const app = wire({
    now: c.now,
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  await (await app.request("/")).body?.cancel();

  // No prior poll, so default t is now.
  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].intent, "scrub");
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
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Datetime-local input format: YYYY-MM-DDTHH:MM (no timezone). The server
  // interprets it in its own timezone (deps.now().timeZoneId, Europe/Berlin).
  const tFuture = T0.add({ minutes: 30 });
  await (await app.request("/?t=2026-05-16T10:30")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].intent, "scrub");
  assertEquals(run.calls[0].args[0].t.toString(), tFuture.toString());
});

Deno.test("GET /?t clamps forward to commit; pass-through between commit and future", async () => {
  const c = clock();
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const app = wire({
    now: c.now,
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Commit at T0 = 10:00. Advance wall clock so commit is in the past.
  await (await app.request("/api/display")).body?.cancel();
  c.advance({ minutes: 5 });

  // ?t before commit — clamped to commit, not now. Commit (not now) is the
  // floor so the operator can still re-visit "what the Device is seeing"
  // (the side-by-side A/B). Plugin gets re-run at the commit moment.
  await (await app.request("/?t=2026-05-16T09:00")).body?.cancel();
  assertEquals(run.calls.at(-1)?.args[0].t.toString(), T0.toString());

  // ?t between commit and now — passes through.
  await (await app.request("/?t=2026-05-16T10:02")).body?.cancel();
  assertEquals(
    run.calls.at(-1)?.args[0].t.toString(),
    at("2026-05-16T10:02").toString(),
  );

  // ?t in the future — passes through.
  await (await app.request("/?t=2026-05-16T15:00")).body?.cancel();
  assertEquals(
    run.calls.at(-1)?.args[0].t.toString(),
    at("2026-05-16T15:00").toString(),
  );
});

Deno.test("GET /?t=<before commit> surfaces the clamp on the page with both the requested and effective t", async () => {
  const app = wire({
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  // Commit at T0; request a moment before commit.
  await (await app.request("/api/display")).body?.cancel();
  const html = await (await app.request("/?t=2026-05-16T09:30")).text();

  assertEquals(html.toLowerCase().includes("clamped"), true, "clamp notice missing");
  assertEquals(html.includes("2026-05-16T09:30"), true, "requested t missing");
  // Effective t = commit (T0 = 10:00).
  assertEquals(html.includes("10:00"), true, "effective t missing");
});

Deno.test("GET /?t=<any> passes through when no Current Result has committed yet", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const app = wire({
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  // No /api/display call → no committed state → nothing to clamp against.
  // A past `?t=` flows through to the Plugin unchanged.
  await (await app.request("/?t=2020-01-01T00:00")).body?.cancel();
  assertEquals(
    run.calls.at(-1)?.args[0].t.toString(),
    at("2020-01-01T00:00").toString(),
  );

  // And the page renders without a clamp notice (nothing was clamped).
  const html = await (await app.request("/?t=2020-01-01T00:00")).text();
  assertEquals(html.toLowerCase().includes("clamped"), false, "should not show clamp notice");
});

Deno.test("GET /?t=<garbage> shows a parse-error notice and falls back to default", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const app = wire({
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  const res = await app.request("/?t=not-a-date");

  assertEquals(res.status, 200, "should not 500 on bad input");
  const html = await res.text();
  assertEquals(html.toLowerCase().includes("could not parse"), true);
  // Plugin still ran (at the default t).
  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].t.toString(), T0.toString());
});

Deno.test("GET / renders pipeline timings: per-step bar + total re-render", async () => {
  const app = wire({
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  const html = await (await app.request("/")).text();

  // Each pipeline step appears as a label in the timings grid.
  assertEquals(html.includes(">run</div>"), true, "run row missing");
  assertEquals(html.includes(">deriveHtml</div>"), true, "deriveHtml row missing");
  assertEquals(html.includes(">identityFor</div>"), true, "identityFor row missing");
  assertEquals(html.includes(">rasterize</div>"), true, "rasterize row missing");
  // Overall total line.
  assertEquals(html.includes("re-render:"), true, "total re-render line missing");
});

Deno.test("GET / surfaces ctx.device in the metadata table", async () => {
  const app = wire({
    plugin: {
      run: (ctx: RunContext) => ({
        state: { seen: ctx.device?.id ?? null },
        validity: fiveMin,
        view: () => "<p>x</p>",
      }),
    },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  // Poll with a device id so latestDevice is populated.
  await (await app.request("/api/display", { headers: { id: "AA:BB:CC" } })).body?.cancel();

  const html = await (await app.request("/")).text();

  // The `device` row is present and shows the id; before any poll it would
  // render "(none yet)".
  assertEquals(html.includes("device"), true, "device row missing");
  assertEquals(html.includes("AA:BB:CC"), true, "device id missing");
});

Deno.test("GET / renders the rendered Image, the scrubber, and Result metadata", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const app = wire({
    plugin: {
      run: () => ({
        state: { msg: "hello" },
        validity: Temporal.Duration.from({ minutes: 7 }),
        view: function MyPluginView(s: { msg: string }) {
          return `<p>${s.msg}</p>`;
        },
      }),
    },
    renderer: {
      deriveHtml: (r: Result<{ msg: string }>) => String(r.view(r.state)),
      rasterize: () => Promise.resolve(png),
    },
    identityFor: () => "dashid",
  });

  const html = await (await app.request("/")).text();

  // Image: inline as data URL so the page is one round trip.
  const b64 = "iVBORw=="; // base64 of [0x89, 0x50, 0x4e, 0x47]
  assertEquals(html.includes(`data:image/png;base64,${b64}`), true, "PNG data URL missing");

  // Scrubber.
  assertEquals(html.includes('name="t"'), true, "scrubber input missing");
  assertEquals(html.includes('type="datetime-local"'), true, "datetime-local input missing");

  // Result metadata, human-formatted (not raw ZonedDateTime / PT-duration).
  assertEquals(html.includes("7m"), true, "validity duration missing");
  assertEquals(html.includes("MyPluginView"), true, "view identity missing");
  assertEquals(html.includes("dashid"), true, "image identity missing");
  // Chosen t (shown to user as the input's value attribute, in datetime-local
  // format YYYY-MM-DDTHH:MM).
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
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  // JSX HTML-escapes quotes inside text nodes; decode to check the JSON the
  // browser ultimately renders to the operator.
  const decoded = (await (await app.request("/")).text()).replaceAll("&quot;", '"');

  assertEquals(decoded.includes('"line"'), true, "state JSON key missing");
  assertEquals(decoded.includes('"U7"'), true, "state JSON value missing");
  assertEquals(decoded.includes('"count": 1'), true, "state JSON pretty-printed");
});

Deno.test("GET / emits forward step links whose ?t= is t + offset in datetime-local form", async () => {
  const c = clock(at("2026-05-16T10:00")); // T0
  const app = wire({
    now: c.now,
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  const html = await (await app.request("/")).text();

  // From T0=10:00, the +5m link should jump to 10:05.
  assertEquals(
    html.includes("?t=2026-05-16T10%3A05") || html.includes("?t=2026-05-16T10:05"),
    true,
  );
  // +1h → 11:00.
  assertEquals(
    html.includes("?t=2026-05-16T11%3A00") || html.includes("?t=2026-05-16T11:00"),
    true,
  );
});

Deno.test("GET / surfaces both committed and current identities when a Current Result exists", async () => {
  // The Plugin returns a state whose serialized form changes with t. The
  // identityFor stub mirrors that, so committed identity != current identity
  // after scrubbing forward.
  const run = (ctx: RunContext) => ({
    state: { at: ctx.t.toString() },
    validity: fiveMin,
    view: (s: { at: string }) => `<p>${s.at}</p>`,
  });
  const app = wire({
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ at: string }>) => String(r.view(r.state)),
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: (html) => `id-${html.length}-${html.slice(-10, -4)}`,
  });

  // Poll commits identity X at T0.
  const poll = await (await app.request("/api/display")).json();
  const committedIdentity = poll.filename.replace(/^image-/, "");

  // Visit dashboard at a non-trivial t so the committed and current columns differ.
  const html = await (await app.request("/?t=2026-05-16T11:00")).text();
  assertEquals(html.includes(committedIdentity), true, "committed identity missing");
  assertEquals(html.includes("11:00"), true, "current t missing in metadata");
  // Column headers present.
  assertEquals(html.includes("committed"), true);
  assertEquals(html.includes("current"), true);
});

// ─── dev-iteration preview routes ──────────────────────────────────────────

Deno.test("GET /preview returns the live HTML at t=now and does not touch Current state", async () => {
  const c = clock();
  const run = spy((ctx: RunContext) => ({
    state: { intent: ctx.intent },
    validity: fiveMin,
    view: (s: { intent: string }) => `<p>${s.intent}</p>`,
  }));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([0xaa])));

  const app = wire({
    now: c.now,
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: (html) => `id-${html}`,
  });

  // Prime Current state with a poll, then scrub via /preview. Current state
  // must not advance — a subsequent /api/display inside the original
  // validity window still serves the poll's image.
  const firstPoll = await (await app.request("/api/display")).json();

  const preview = await app.request("/preview");
  assertEquals(preview.status, 200);
  assertEquals(preview.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(await preview.text(), "<p>scrub</p>");

  const secondPoll = await (await app.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
  assertSpyCalls(rasterize, 1); // poll triggered one rasterize; /preview never did
});

Deno.test("GET /preview returns status 500 with the error view HTML when the Plugin throws", async () => {
  const boom = new Error("plugin boom");
  const app = wire({
    plugin: {
      run: () => {
        throw boom;
      },
    },
    renderer: {
      deriveHtml: (r: Result<unknown>) => String(r.view(r.state)),
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
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

Deno.test("GET /preview/png returns the rasterized PNG and does not touch Current state", async () => {
  const c = clock();
  const previewPng = new Uint8Array([0xbb]);
  const pollPng = new Uint8Array([0xcc]);
  const pngs = [pollPng, previewPng];
  let p = 0;
  const rasterize = spy(() => Promise.resolve(pngs[p++]));

  const app = wire({
    now: c.now,
    plugin: {
      run: (ctx: RunContext) => ({
        state: { intent: ctx.intent },
        validity: fiveMin,
        view: (s: { intent: string }) => `<p>${s.intent}</p>`,
      }),
    },
    renderer: {
      deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: (html) => `id-${html}`,
  });

  const firstPoll = await (await app.request("/api/display")).json();

  const preview = await app.request("/preview/png");
  assertEquals(preview.status, 200);
  assertEquals(preview.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await preview.arrayBuffer()), previewPng);
  assertSpyCalls(rasterize, 2); // poll + preview/png both rasterized

  // Current state untouched: /api/display still serves the poll's image.
  const secondPoll = await (await app.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
});
