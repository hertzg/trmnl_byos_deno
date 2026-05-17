/** @jsxImportSource hono/jsx */
import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { createRenderer, type RendererDeps } from "./renderer.ts";
import { hashBundle } from "../hash.ts";
import type { Bundle } from "../plugin/bundle.ts";

const fiveMin = Temporal.Duration.from({ minutes: 5 });

function bundleWith(
  state: unknown,
  view: (s: unknown) => unknown,
  assets: Record<string, Uint8Array> = {},
): Bundle {
  return {
    result: { state, validity: fiveMin, view },
    assets,
  };
}

// Default deps. `fetchPngFromUrl` returns one byte; tests that care about
// bytes inject their own. Tests that don't care just use the default and
// `close()` the renderer in a `try/finally`.
function defaults(overrides: Partial<RendererDeps> = {}): RendererDeps {
  return {
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array([0x01])),
    ...overrides,
  };
}

// ─── identity ──────────────────────────────────────────────────────────────

Deno.test("Renderer.identity delegates to hashBundle and returns its hash", async () => {
  const renderer = await createRenderer(defaults());
  try {
    const bundle = bundleWith(
      { greeting: "hi" },
      (s) => <p>{(s as { greeting: string }).greeting}</p>,
    );

    const id = await renderer.identity(bundle);

    assertEquals(id, await hashBundle(bundle));
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.identity is deterministic for equivalent bundles", async () => {
  const renderer = await createRenderer(defaults());
  try {
    const a = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);
    const b = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);

    assertEquals(await renderer.identity(a), await renderer.identity(b));
  } finally {
    await renderer.close();
  }
});

// ─── loopback origin ───────────────────────────────────────────────────────

Deno.test("Renderer.origin returns a loopback http URL with an assigned port", async () => {
  const renderer = await createRenderer(defaults());
  try {
    // 127.0.0.1 keeps the loopback un-reachable from any other interface.
    // The port is the OS-assigned ephemeral port we got from listen({port:0}).
    assertMatch(renderer.origin(), /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await renderer.close();
  }
});

Deno.test("Renderer.origin is stable across calls for the same instance", async () => {
  const renderer = await createRenderer(defaults());
  try {
    assertEquals(renderer.origin(), renderer.origin());
  } finally {
    await renderer.close();
  }
});

Deno.test("Two Renderer instances pick distinct ports (each takes its own ephemeral port)", async () => {
  const a = await createRenderer(defaults());
  const b = await createRenderer(defaults());
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>x</p>));
    assertEquals(status, 404);
  } finally {
    await renderer.close();
  }
});

// ─── rasterize wiring ──────────────────────────────────────────────────────

Deno.test("Renderer.rasterize returns the PNG bytes from the injected fetcher", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(png));
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
  try {
    await renderer.rasterize(bundleWith({}, () => <p>x</p>));

    const url = fetchPngFromUrl.calls[0].args[0];
    assertEquals(url.startsWith(renderer.origin() + "/"), true, `${url} should be on the loopback`);
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
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
  const renderer = await createRenderer(defaults({ fetchPngFromUrl }));
  try {
    const first = renderer.rasterize(bundleWith({}, () => <p>first</p>));
    const second = renderer.rasterize(bundleWith({}, () => <p>second</p>));
    await Promise.all([first, second]);

    assertEquals(seen, ["<!DOCTYPE html><p>first</p>", "<!DOCTYPE html><p>second</p>"]);
  } finally {
    await renderer.close();
  }
});
