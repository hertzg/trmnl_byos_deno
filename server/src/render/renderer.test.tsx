/** @jsxImportSource hono/jsx */
import { assertEquals, assertMatch, assertNotEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { renderToString } from "hono/jsx/dom/server";
import { createRenderer, type RendererDeps } from "./renderer.ts";
import { hash } from "../hash.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { ResultHints } from "../plugin/plugin.ts";

const fiveMin = Temporal.Duration.from({ minutes: 5 });

function bundleWith(
  state: unknown,
  view: (s: unknown) => unknown,
  assets: Record<string, Uint8Array<ArrayBuffer>> = {},
  hints?: ResultHints,
): Bundle {
  return {
    result: { state, validity: fiveMin, hints, view },
    assets,
  };
}

// Independent re-derivation of the identity Renderer computes for a
// hint-less Bundle (render → HTML, concat with sorted asset bytes, hash) —
// an oracle for the "equals the bundle-payload hash" assertion below. The
// concatenation format is Renderer-internal (`bundlePayload` in
// renderer.ts); duplicated here only as a known-good reference, not because
// callers should ever reproduce it.
async function expectedBundlePayloadHash(bundle: Bundle): Promise<string> {
  const html = renderToString(
    bundle.result.view(bundle.result.state) as Parameters<typeof renderToString>[0],
  );
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode(html)];
  for (const key of [...Object.keys(bundle.assets)].sort()) {
    parts.push(encoder.encode(key), new Uint8Array([0]), bundle.assets[key], new Uint8Array([0]));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return await hash(out);
}

// Default deps. `fetchPngFromUrl` returns one byte; tests that care about
// bytes inject their own. Tests that don't care just use the default and
// `close()` the renderer in a `try/finally`.
//
// `loopbackHost` is pinned to "127.0.0.1" so the test process can actually
// reach the loopback origin via `fetch()`. The production default is
// "host.docker.internal" (the `deno task dev` workflow), which only
// resolves inside the docker bridge — the loopback-host tests below
// exercise both defaults explicitly through dedicated cases.
function defaults(overrides: Partial<RendererDeps> = {}): RendererDeps {
  return {
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array([0x01])),
    loopbackHost: "127.0.0.1",
    ...overrides,
  };
}

// ─── identity: no hint — bundle-payload hash ───────────────────────────────

Deno.test("Renderer.identity with no hints.identity equals the bundle-payload hash", async () => {
  const renderer = createRenderer(defaults());
  try {
    const bundle = bundleWith(
      { greeting: "hi" },
      (s) => <p>{(s as { greeting: string }).greeting}</p>,
    );

    const id = await renderer.identity(bundle);

    assertEquals(id, await expectedBundlePayloadHash(bundle));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity is deterministic for equivalent bundles", async () => {
  const renderer = createRenderer(defaults());
  try {
    const a = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);
    const b = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);

    assertEquals(await renderer.identity(a), await renderer.identity(b));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity changes when the rendered HTML changes", async () => {
  const renderer = createRenderer(defaults());
  try {
    const hi = bundleWith({ greeting: "hi" }, (s) => <p>{(s as { greeting: string }).greeting}</p>);
    const ciao = bundleWith(
      { greeting: "ciao" },
      (s) => <p>{(s as { greeting: string }).greeting}</p>,
    );

    assertNotEquals(await renderer.identity(hi), await renderer.identity(ciao));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity changes when an asset's bytes change", async () => {
  const renderer = createRenderer(defaults());
  try {
    const original = bundleWith({}, () => <p>same</p>, {
      "/assets/a.bin": new Uint8Array([1, 2, 3]),
    });
    const edited = bundleWith({}, () => <p>same</p>, {
      "/assets/a.bin": new Uint8Array([1, 2, 4]),
    });

    assertNotEquals(await renderer.identity(original), await renderer.identity(edited));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity ignores the insertion order of asset keys", async () => {
  const renderer = createRenderer(defaults());
  try {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3, 4]);
    const ab = bundleWith({}, () => <p>same</p>, { "/assets/a": a, "/assets/b": b });
    const ba = bundleWith({}, () => <p>same</p>, { "/assets/b": b, "/assets/a": a });

    assertEquals(await renderer.identity(ab), await renderer.identity(ba));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity changes when an asset key is renamed (bytes identical)", async () => {
  const renderer = createRenderer(defaults());
  try {
    const bytes = new Uint8Array([1, 2, 3]);
    const atA = bundleWith({}, () => <p>same</p>, { "/assets/a": bytes });
    const atB = bundleWith({}, () => <p>same</p>, { "/assets/b": bytes });

    assertNotEquals(await renderer.identity(atA), await renderer.identity(atB));
  } finally {
    await renderer.close();
  }
});

// ─── identity: asserted hints.identity short-circuits ─────────────────────

Deno.test("Renderer.identity with hints.identity present returns hash(asserted), stable while the HTML churns", async () => {
  const renderer = createRenderer(defaults());
  try {
    let sig = 0;
    const churning = () =>
      bundleWith(
        { sig: ++sig },
        (s) => <img src={`https://cdn.example/photo?sig=${(s as { sig: number }).sig}`} />,
        {},
        { identity: "photo:chk-constant" },
      );

    const first = await renderer.identity(churning());
    const second = await renderer.identity(churning());

    assertEquals(first, await hash("photo:chk-constant"));
    assertEquals(second, first);
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity with hints.identity present differs from the no-hint identity of the same Bundle", async () => {
  const renderer = createRenderer(defaults());
  try {
    const state = { greeting: "hi" };
    const view = (s: unknown) => <p>{(s as { greeting: string }).greeting}</p>;
    const noHint = bundleWith(state, view);
    const withHint = bundleWith(state, view, {}, { identity: "photo:chk-1" });

    assertNotEquals(await renderer.identity(noHint), await renderer.identity(withHint));
  } finally {
    await renderer.close();
  }
});

// ─── loopback origin ───────────────────────────────────────────────────────

Deno.test("Renderer.origin returns a loopback http URL with an assigned port", async () => {
  const renderer = createRenderer(defaults());
  try {
    // The test harness pins `loopbackHost: "127.0.0.1"` (see `defaults()`).
    // The port is the OS-assigned ephemeral port we got from listen({port:0}).
    assertMatch(renderer.origin(), /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.origin is stable across calls for the same instance", async () => {
  const renderer = createRenderer(defaults());
  try {
    assertEquals(renderer.origin(), renderer.origin());
  } finally {
    await renderer.close();
  }
});

Deno.test("Two Renderer instances pick distinct ports (each takes its own ephemeral port)", async () => {
  const a = createRenderer(defaults());
  const b = createRenderer(defaults());
  try {
    assertNotEquals(a.origin(), b.origin());
  } finally {
    await a.close();
    await b.close();
  }
});

// ─── loopback serves Bundle HTML + assets during rasterize ─────────────────

Deno.test("loopback origin serves the mounted Bundle's HTML at /index.html during rasterize", async () => {
  let seenHtml: string | null = null;
  const fetchPngFromUrl = spy(async (url: string) => {
    seenHtml = await (await fetch(url)).text();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      { msg: "ahoy" },
      (s) => <p>{(s as { msg: string }).msg}</p>,
    ));
    assertEquals(seenHtml, "<!DOCTYPE html><p>ahoy</p>");
  } finally {
    await renderer.close();
  }
});

Deno.test("loopback origin serves the mounted Bundle's assets at their /assets/<path> URLs", async () => {
  const svg = new TextEncoder().encode("<svg id=icon/>");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  let fetchedSvg: string | null = null;
  let fetchedPng: Uint8Array | null = null;
  const fetchPngFromUrl = spy(async (url: string) => {
    const base = new URL(url);
    fetchedSvg = await (await fetch(new URL("/assets/icon.svg", base))).text();
    fetchedPng = new Uint8Array(
      await (await fetch(new URL("/assets/nested/photo.png", base))).arrayBuffer(),
    );
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      {},
      () => <p>x</p>,
      {
        "/assets/icon.svg": svg,
        "/assets/nested/photo.png": png,
      },
    ));
    assertEquals(fetchedSvg, "<svg id=icon/>");
    assertEquals(fetchedPng, png);
  } finally {
    await renderer.close();
  }
});

Deno.test("loopback origin returns 404 for asset paths not declared by the mounted Bundle", async () => {
  let status = 0;
  const fetchPngFromUrl = spy(async (url: string) => {
    const r = await fetch(new URL("/assets/missing.css", new URL(url)));
    status = r.status;
    await r.body?.cancel();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>x</p>));
    assertEquals(status, 404);
  } finally {
    await renderer.close();
  }
});

// ─── asset Content-Type ────────────────────────────────────────────────────

Deno.test("loopback origin serves SVG assets with an image/svg+xml Content-Type", async () => {
  // Load-bearing: Chrome refuses to render an SVG inside an <img> unless it's
  // served as image/svg+xml, so a missing/wrong type breaks the BVG glyphs.
  let contentType: string | null = null;
  const fetchPngFromUrl = spy(async (url: string) => {
    const r = await fetch(new URL("/assets/icon.svg", new URL(url)));
    contentType = r.headers.get("content-type");
    await r.body?.cancel();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      {},
      () => <p>x</p>,
      { "/assets/icon.svg": new TextEncoder().encode("<svg id=icon/>") },
    ));
    assertStringIncludes(contentType ?? "", "image/svg+xml");
  } finally {
    await renderer.close();
  }
});

Deno.test("loopback origin serves CSS assets with a text/css Content-Type", async () => {
  let contentType: string | null = null;
  const fetchPngFromUrl = spy(async (url: string) => {
    const r = await fetch(new URL("/assets/style.css", new URL(url)));
    contentType = r.headers.get("content-type");
    await r.body?.cancel();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      {},
      () => <p>x</p>,
      { "/assets/style.css": new TextEncoder().encode("p{color:#000}") },
    ));
    assertStringIncludes(contentType ?? "", "text/css");
  } finally {
    await renderer.close();
  }
});

Deno.test("loopback origin serves PNG assets with an image/png Content-Type", async () => {
  let contentType: string | null = null;
  const fetchPngFromUrl = spy(async (url: string) => {
    const r = await fetch(new URL("/assets/photo.png", new URL(url)));
    contentType = r.headers.get("content-type");
    await r.body?.cancel();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      {},
      () => <p>x</p>,
      { "/assets/photo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ));
    assertStringIncludes(contentType ?? "", "image/png");
  } finally {
    await renderer.close();
  }
});

Deno.test("loopback origin omits Content-Type for assets with an unknown extension", async () => {
  // Unknown/absent extension: omit the header rather than invent a type.
  let contentType: string | null = "unset";
  const fetchPngFromUrl = spy(async (url: string) => {
    const r = await fetch(new URL("/assets/data", new URL(url)));
    contentType = r.headers.get("content-type");
    await r.body?.cancel();
    return new Uint8Array([0x01]);
  });
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith(
      {},
      () => <p>x</p>,
      { "/assets/data": new Uint8Array([0x00, 0x01]) },
    ));
    assertEquals(contentType, null);
  } finally {
    await renderer.close();
  }
});

// ─── rasterize wiring ──────────────────────────────────────────────────────

Deno.test("Renderer.rasterize returns the PNG bytes from the injected fetcher", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(png));
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    const out = await renderer.rasterize(bundleWith({}, () => <p>x</p>));

    assertEquals(out, png);
    assertSpyCalls(fetchPngFromUrl, 1);
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.rasterize hands the fetcher a URL on the loopback origin (not an outward server)", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>x</p>));

    const url = fetchPngFromUrl.calls[0].args[0];
    assertEquals(url.startsWith(renderer.origin() + "/"), true, `${url} should be on the loopback`);
  } finally {
    await renderer.close();
  }
});

// ─── loopback host configurability ─────────────────────────────────────────

Deno.test("default loopbackHost: URL handed to CDP is on http://host.docker.internal:<port> (deno-task-dev default; binds 0.0.0.0)", async () => {
  // The `deno task dev` workflow is the common path: deno runs on the host
  // and chrome runs in docker, reaching the host via `host.docker.internal`.
  // The default Just Works for that workflow; compose mode opts in to
  // `LOOPBACK_HOST=127.0.0.1` via docker-compose.yml. This test deliberately
  // constructs the renderer WITHOUT going through `defaults()` so it sees
  // the production default for `loopbackHost`; we never `rasterize()` here
  // because `host.docker.internal` doesn't resolve in the test process — we
  // only assert on `origin()` and the URL the renderer would hand CDP.
  const renderer = createRenderer({
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array([0x01])),
  });
  try {
    assertMatch(renderer.origin(), /^http:\/\/host\.docker\.internal:\d+$/);
  } finally {
    await renderer.close();
  }
});

Deno.test("loopbackHost override to 127.0.0.1: URL handed to CDP stays on the loopback interface (compose-mode override)", async () => {
  // Compose mode pins LOOPBACK_HOST=127.0.0.1 in docker-compose.yml because
  // chrome shares the deno container's network namespace and 127.0.0.1
  // resolves to the deno process — and binding the ephemeral port on the
  // loopback interface only keeps it un-reachable from outside the container.
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const renderer = createRenderer(defaults({
    fetchPngFromUrl,
    loopbackHost: "127.0.0.1",
  }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>x</p>));

    const url = fetchPngFromUrl.calls[0].args[0];
    assertMatch(url, /^http:\/\/127\.0\.0\.1:\d+\//);
    assertMatch(renderer.origin(), /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await renderer.close();
  }
});

// ─── concurrency: single-mount with lock ───────────────────────────────────

Deno.test("sequential rasterize calls each see only their own Bundle's HTML", async () => {
  // Single-mount-with-lock: rasterize calls serialize. Each call mounts its
  // own Bundle for the duration of the CDP roundtrip. A second caller never
  // sees the first caller's HTML through the loopback.
  const seen: string[] = [];
  const fetchPngFromUrl = async (url: string) => {
    seen.push(await (await fetch(url)).text());
    return new Uint8Array([0x01]);
  };
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>first</p>));
    await renderer.rasterize(bundleWith({}, () => <p>second</p>));

    assertEquals(seen, ["<!DOCTYPE html><p>first</p>", "<!DOCTYPE html><p>second</p>"]);
  } finally {
    await renderer.close();
  }
});

Deno.test("concurrent rasterize calls serialize so each one's loopback fetch returns its own HTML", async () => {
  // Single-mount-with-lock: a second rasterize that starts while the first is
  // still in-flight waits for the lock. By the time CDP fetches in the second
  // call, the loopback is serving the second Bundle, not the first.
  const seen: string[] = [];
  const fetchPngFromUrl = async (url: string) => {
    // Yield a couple of microtasks so an unlocked implementation would race.
    await Promise.resolve();
    await Promise.resolve();
    seen.push(await (await fetch(url)).text());
    return new Uint8Array([0x01]);
  };
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));
  try {
    const first = renderer.rasterize(bundleWith({}, () => <p>first</p>));
    const second = renderer.rasterize(bundleWith({}, () => <p>second</p>));
    await Promise.all([first, second]);

    assertEquals(seen, ["<!DOCTYPE html><p>first</p>", "<!DOCTYPE html><p>second</p>"]);
  } finally {
    await renderer.close();
  }
});
