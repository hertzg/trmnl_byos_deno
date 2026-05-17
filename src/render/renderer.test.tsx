/** @jsxImportSource hono/jsx */
import { assertEquals } from "@std/assert";
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

function defaults(overrides: Partial<RendererDeps> = {}): RendererDeps {
  return {
    internalOrigin: "http://internal:3000",
    // Default fetcher returns one byte; tests that care about bytes inject
    // their own.
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array([0x01])),
    ...overrides,
  };
}

// ─── identity ──────────────────────────────────────────────────────────────

Deno.test("Renderer.identity delegates to hashBundle and returns its hash", async () => {
  const renderer = createRenderer(defaults());
  const bundle = bundleWith(
    { greeting: "hi" },
    (s) => <p>{(s as { greeting: string }).greeting}</p>,
  );

  const id = await renderer.identity(bundle);

  assertEquals(id, await hashBundle(bundle));
});

Deno.test("Renderer.identity is deterministic for equivalent bundles", async () => {
  const renderer = createRenderer(defaults());
  const a = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);
  const b = bundleWith({ x: 1 }, (s) => <p>{String((s as { x: number }).x)}</p>);

  assertEquals(await renderer.identity(a), await renderer.identity(b));
});

// ─── rasterize ─────────────────────────────────────────────────────────────

Deno.test("Renderer.rasterize returns the PNG bytes from the injected fetcher", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic prefix
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(png));
  const renderer = createRenderer(defaults({ fetchPngFromUrl }));

  const out = await renderer.rasterize(bundleWith({}, () => <p>x</p>));

  assertEquals(out, png);
  assertSpyCalls(fetchPngFromUrl, 1);
});

Deno.test("Renderer.rasterize hands the fetcher the internalOrigin /preview URL", async () => {
  const fetchPngFromUrl = spy((_url: string) => Promise.resolve(new Uint8Array([0x01])));
  const renderer = createRenderer(defaults({
    internalOrigin: "http://internal:9999",
    fetchPngFromUrl,
  }));

  await renderer.rasterize(bundleWith({}, () => <p>x</p>));

  assertEquals(fetchPngFromUrl.calls[0].args[0], "http://internal:9999/preview");
});
