import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Result, RunContext } from "../plugin/plugin.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

// `clock()` returns a mutable `now()` thunk + a setter so tests can advance
// time between requests (the validity-window and identity-skip tests need
// successive /api/display calls to land at different `t` values).
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

// ─── orchestration via HTTP ────────────────────────────────────────────────

Deno.test("first poll calls run + deriveHtml + rasterize and the resulting PNG is served by /images/:identity/png", async () => {
  const png = new Uint8Array([1, 2, 3]);
  const run = spy(() => ({
    state: { msg: "hi" },
    validity: fiveMin,
    view: (s: { msg: string }) => `<p>${s.msg}</p>`,
  }));
  const deriveHtml = spy((r: Result<{ msg: string }>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(png));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: () => "id",
  });

  const display = await conductor.request("/api/display");
  const body = await display.json();
  const identity = body.filename.replace(/^image-/, "");
  const imageRes = await conductor.request(`/images/${identity}/png`);

  assertEquals(identity, "id");
  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(new Uint8Array(await imageRes.arrayBuffer()), png);
});

Deno.test("polls inside the validity window reuse the Current Image without re-invoking the Plugin or rasterize", async () => {
  const c = clock();
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(new Uint8Array([7])));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => html,
  });

  await (await conductor.request("/api/display")).body?.cancel();
  c.advance({ minutes: 1 });
  await (await conductor.request("/api/display")).body?.cancel();
  c.advance({ minutes: 3 });
  await (await conductor.request("/api/display")).body?.cancel();

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 1);
  assertSpyCalls(rasterize, 1);
});

Deno.test("poll after expiry rasterizes a fresh Current Image when the derived HTML's identity differs", async () => {
  const c = clock();
  const pngs = [new Uint8Array([1]), new Uint8Array([2])];
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }));
  const htmls = ["a", "b"];
  let i = 0;
  const deriveHtml = spy(() => htmls[i++]);
  let j = 0;
  const rasterize = spy(() => Promise.resolve(pngs[j++]));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
  });

  await (await conductor.request("/api/display")).body?.cancel();
  c.advance({ minutes: 6 });
  await (await conductor.request("/api/display")).body?.cancel();

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 2);

  // The Current Image is now the second PNG; /images/id-b/png returns it.
  const res = await conductor.request("/images/id-b/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), pngs[1]);
});

Deno.test("poll after expiry skips rasterize and keeps the Current Image when the derived HTML's identity matches", async () => {
  const c = clock();
  const expectedPng = new Uint8Array([42]);
  const run = spy(() => ({ state: {}, validity: fiveMin, view: () => "<p>stable</p>" }));
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(expectedPng));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: () => "stable-identity",
  });

  await (await conductor.request("/api/display")).body?.cancel();
  c.advance({ minutes: 6 });
  await (await conductor.request("/api/display")).body?.cancel();

  assertSpyCalls(run, 2);
  assertSpyCalls(deriveHtml, 2);
  assertSpyCalls(rasterize, 1);

  const res = await conductor.request("/images/stable-identity/png");
  assertEquals(new Uint8Array(await res.arrayBuffer()), expectedPng);
});

Deno.test("when Plugin.run throws, the error view is rendered and reused inside its short validity window", async () => {
  const c = clock();
  const errorPng = new Uint8Array([0xee]);
  const boom = new Error("boom");

  const run = spy(() => {
    throw boom;
  });
  const errorView = spy((_err: Error) => "error");
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  const rasterize = spy(() => Promise.resolve(errorPng));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    errorView,
  });

  const first = await (await conductor.request("/api/display")).json();
  c.advance({ seconds: 20 });
  const second = await (await conductor.request("/api/display")).json();

  // The error result's validity (30s) governs reuse: 20s < 30s so the
  // second call short-circuits — no further run/errorView/rasterize.
  assertSpyCalls(run, 1);
  assertSpyCalls(errorView, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(errorView.calls[0].args[0], boom);
  assertEquals(second.filename, first.filename);

  const imgUrl = new URL(first.image_url);
  const img = await conductor.request(imgUrl.pathname);
  assertEquals(new Uint8Array(await img.arrayBuffer()), errorPng);
});

Deno.test("when deriveHtml throws on the Plugin's Result, the error view is rendered instead", async () => {
  const errorPng = new Uint8Array([0xee]);
  const boom = new Error("derive boom");

  const run = spy(() => ({
    state: { ok: true },
    validity: fiveMin,
    view: () => "<p>real</p>",
  }));
  const errorView = spy((_err: Error) => "error");
  // First call (Plugin's Result) throws; second call (error Result) succeeds.
  let calls = 0;
  const deriveHtml = spy((r: Result<unknown>) => {
    calls++;
    if (calls === 1) throw boom;
    return String(r.view(r.state));
  });
  const rasterize = spy(() => Promise.resolve(errorPng));

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    errorView,
  });

  const res = await (await conductor.request("/api/display")).json();

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 2); // once for Plugin (threw), once for error view
  assertSpyCalls(errorView, 1);
  assertSpyCalls(rasterize, 1);
  assertEquals(errorView.calls[0].args[0], boom);
  assertEquals(res.filename, "image-id-error");
});

Deno.test("when rasterize throws on the Plugin's HTML, the error view is rendered and rasterized instead", async () => {
  const errorPng = new Uint8Array([0xee]);
  const boom = new Error("rasterize boom");

  const run = spy(() => ({
    state: { ok: true },
    validity: fiveMin,
    view: () => "<p>real</p>",
  }));
  const errorView = spy((_err: Error) => "error");
  const deriveHtml = spy((r: Result<unknown>) => String(r.view(r.state)));
  // First call (Plugin's HTML) throws; second call (error view's HTML) succeeds.
  let calls = 0;
  const rasterize = spy(() => {
    calls++;
    if (calls === 1) return Promise.reject(boom);
    return Promise.resolve(errorPng);
  });

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: { deriveHtml, rasterize },
    identityFor: (html) => `id-${html}`,
    errorView,
  });

  const res = await (await conductor.request("/api/display")).json();

  assertSpyCalls(run, 1);
  assertSpyCalls(deriveHtml, 2); // once for Plugin, once for error view
  assertSpyCalls(errorView, 1);
  assertSpyCalls(rasterize, 2); // once for Plugin (threw), once for error view
  assertEquals(errorView.calls[0].args[0], boom);
  assertEquals(res.filename, "image-id-error");
});

// ─── BYOS surface ──────────────────────────────────────────────────────────

Deno.test("GET /api/setup returns BYOS setup JSON with friendlyId", async () => {
  const conductor = createConductor({
    ...defaults({ friendlyId: "MY-DEVICE" }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    renderer: {
      deriveHtml: () => "",
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
    identityFor: () => "x",
  });

  const res = await conductor.request("/api/setup");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 200);
  assertEquals(body.friendly_id, "MY-DEVICE");
});

Deno.test("GET /api/display returns image_url / filename / refresh_rate derived from the trigger output", async () => {
  const conductor = createConductor({
    ...defaults(),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x89])),
    },
    identityFor: () => "deadbeefcafef00d",
  });

  const res = await conductor.request("/api/display", { headers: { id: "AA:BB:CC" } });
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/images/deadbeefcafef00d/png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
});

Deno.test("GET /api/display forwards a parsed DeviceReport into the next Plugin.run via ctx.device", async () => {
  const run = spy((ctx: RunContext) => ({
    state: { seenId: ctx.device?.id ?? null },
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
    identityFor: () => "x",
  });

  await (await conductor.request("/api/display", { headers: { id: "AA:BB:CC" } })).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].device?.id, "AA:BB:CC");
});

Deno.test("GET /api/display leaves ctx.device null when the request has no ID header", async () => {
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
    identityFor: () => "x",
  });

  await (await conductor.request("/api/display")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].device, null);
});

Deno.test("GET /images/:identity/png returns 404 for an unknown identity", async () => {
  const conductor = createConductor({
    ...defaults(),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
    identityFor: () => "knownid000000000",
  });

  await (await conductor.request("/api/display")).body?.cancel();
  const res = await conductor.request("/images/somethingelse/png");
  await res.body?.cancel();

  assertEquals(res.status, 404);
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

  const conductor = createConductor({
    ...defaults({ now: c.now }),
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
  const firstPoll = await (await conductor.request("/api/display")).json();

  const preview = await conductor.request("/preview");
  assertEquals(preview.status, 200);
  assertEquals(preview.headers.get("content-type")?.startsWith("text/html"), true);
  assertEquals(await preview.text(), "<p>scrub</p>");

  const secondPoll = await (await conductor.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
  assertSpyCalls(rasterize, 1); // poll triggered one rasterize; /preview never did
});

Deno.test("GET /preview/png returns the rasterized PNG and does not touch Current state", async () => {
  const c = clock();
  const previewPng = new Uint8Array([0xbb]);
  const pollPng = new Uint8Array([0xcc]);
  const pngs = [pollPng, previewPng];
  let p = 0;
  const rasterize = spy(() => Promise.resolve(pngs[p++]));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
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

  const firstPoll = await (await conductor.request("/api/display")).json();
  // After the poll, Current Image is `pollPng` with identity `id-<p>poll</p>`.

  const preview = await conductor.request("/preview/png");
  assertEquals(preview.status, 200);
  assertEquals(preview.headers.get("content-type"), "image/png");
  assertEquals(new Uint8Array(await preview.arrayBuffer()), previewPng);
  assertSpyCalls(rasterize, 2); // poll + preview/png both rasterized

  // Current state untouched: /api/display still serves the poll's image.
  const secondPoll = await (await conductor.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
});

// ─── dashboard at / ────────────────────────────────────────────────────────

Deno.test("GET / returns 200 with an HTML dashboard page", async () => {
  const conductor = createConductor({
    ...defaults(),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x89])),
    },
    identityFor: () => "x",
  });

  const res = await conductor.request("/");

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

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: {
      deriveHtml: (r: Result<{ intent: string }>) => String(r.view(r.state)),
      rasterize,
    },
    identityFor: (html) => `id-${html}`,
  });

  // Prime Current state with a real poll.
  const firstPoll = await (await conductor.request("/api/display")).json();
  assertSpyCalls(rasterize, 1);

  // Dashboard scrubs.
  await (await conductor.request("/")).body?.cancel();

  // The dashboard's run was a scrub.
  assertEquals(run.calls.at(-1)?.args[0].intent, "scrub");

  // Inside the original validity window, /api/display still serves the
  // poll's image — Current state untouched.
  c.advance({ minutes: 1 });
  const secondPoll = await (await conductor.request("/api/display")).json();
  assertEquals(secondPoll.filename, firstPoll.filename);
});

Deno.test("GET / defaults t to the Current Result's commit moment when one exists", async () => {
  const c = clock();
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Poll at T0 → Current Result committed at T0. (No wall-clock advance, so
  // the forward-only clamp t_min = max(T0, now=T0) = T0 doesn't fight the
  // default. When wall-clock advances past commit, the clamp wins — see the
  // "clamped forward" test below.)
  await (await conductor.request("/api/display")).body?.cancel();
  await (await conductor.request("/")).body?.cancel();

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

  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  await (await conductor.request("/")).body?.cancel();

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

  const conductor = createConductor({
    ...defaults(),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Datetime-local input format: YYYY-MM-DDTHH:MM (no timezone). The server
  // interprets it in its own timezone (deps.now().timeZoneId, Europe/Berlin).
  const tFuture = T0.add({ minutes: 30 }); // 2026-05-16T10:30[Europe/Berlin]
  await (await conductor.request("/?t=2026-05-16T10:30")).body?.cancel();

  assertEquals(run.calls.length, 1);
  assertEquals(run.calls[0].args[0].intent, "scrub");
  assertEquals(run.calls[0].args[0].t.toString(), tFuture.toString());
});

Deno.test("GET /?t=<past> is clamped forward to max(t_current, now)", async () => {
  const c = clock();
  const run = spy((_ctx: RunContext) => ({
    state: {},
    validity: fiveMin,
    view: () => "<p>x</p>",
  }));
  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0x01])),
    },
    identityFor: () => "id",
  });

  // Poll at T0, then advance wall clock 2 min. t_min = max(T0, T0+2m) = T0+2m.
  await (await conductor.request("/api/display")).body?.cancel();
  c.advance({ minutes: 2 });
  const tMin = c.now();

  // Ask for t in the past (before t_min). Should clamp to t_min.
  await (await conductor.request("/?t=2026-05-16T09:00")).body?.cancel();
  assertEquals(run.calls.at(-1)?.args[0].t.toString(), tMin.toString());

  // Ask for t before T0 (before t_current). Should also clamp to t_min (now).
  await (await conductor.request("/?t=2026-05-16T09:30")).body?.cancel();
  assertEquals(run.calls.at(-1)?.args[0].t.toString(), tMin.toString());
});

Deno.test("GET / renders the rendered Image, the scrubber, and Result metadata", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const conductor = createConductor({
    ...defaults(),
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

  const res = await conductor.request("/");
  const html = await res.text();

  // Image: inline as data URL so the page is one round trip.
  const b64 = "iVBORw=="; // base64 of [0x89, 0x50, 0x4e, 0x47]
  assertEquals(html.includes(`data:image/png;base64,${b64}`), true, "PNG data URL missing");

  // Forward-only scrubber.
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
  const conductor = createConductor({
    ...defaults(),
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
  const decoded = (await (await conductor.request("/")).text()).replaceAll("&quot;", '"');

  assertEquals(decoded.includes('"line"'), true, "state JSON key missing");
  assertEquals(decoded.includes('"U7"'), true, "state JSON value missing");
  assertEquals(decoded.includes('"count": 1'), true, "state JSON pretty-printed");
});

Deno.test("GET / emits forward step links whose ?t= is t + offset in datetime-local form", async () => {
  const c = clock(at("2026-05-16T10:00")); // T0
  const conductor = createConductor({
    ...defaults({ now: c.now }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }) },
    renderer: {
      deriveHtml: () => "<p>x</p>",
      rasterize: () => Promise.resolve(new Uint8Array([0])),
    },
    identityFor: () => "id",
  });

  const html = await (await conductor.request("/")).text();

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

Deno.test("GET /assets/:file serves files from pluginAssetsDir without the /assets prefix duplicating in the path", async () => {
  const assetsDir = await Deno.makeTempDir({ prefix: "conductor-assets-test-" });
  await Deno.writeTextFile(`${assetsDir}/style.css`, ".x { color: red; }");

  const conductor = createConductor({
    ...defaults({ pluginAssetsDir: assetsDir }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    renderer: { deriveHtml: () => "", rasterize: () => Promise.resolve(new Uint8Array()) },
    identityFor: () => "x",
  });

  const res = await conductor.request("/assets/style.css");

  assertEquals(res.status, 200);
  assertEquals(await res.text(), ".x { color: red; }");
});

Deno.test("POST /api/log returns 204 and invokes onDeviceLog with the id header + body", async () => {
  const onDeviceLog = spy((_id: string, _body: string) => {});
  const conductor = createConductor({
    ...defaults({ onDeviceLog }),
    plugin: { run: () => ({ state: {}, validity: fiveMin, view: () => "" }) },
    renderer: { deriveHtml: () => "", rasterize: () => Promise.resolve(new Uint8Array()) },
    identityFor: () => "x",
  });

  const res = await conductor.request("/api/log", {
    method: "POST",
    headers: { id: "AA:BB:CC" },
    body: "hello",
  });
  await res.body?.cancel();

  assertEquals(res.status, 204);
  assertEquals(onDeviceLog.calls[0].args, ["AA:BB:CC", "hello"]);
});
