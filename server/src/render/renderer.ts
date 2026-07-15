import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { contentType } from "@std/media-types";
import { extname } from "@std/path";
import type { Bundle } from "../plugin/bundle.ts";
import { hash } from "../hash.ts";
import type { DeviceProfile } from "./profiles.ts";
import { connect } from "@astral/astral";
import { initPage, type Page, renderUrl, resolveCdpEndpoint } from "./_internal/cdp.ts";
import { dither, type DitherEngine } from "./_internal/dither.ts";
import { timed } from "../telemetry/spans.ts";

// Renderer: Bundle → Image. See ADR-0003 / CONTEXT.md.
// Owns a loopback HTTP origin that serves the mounted Bundle's HTML +
// assets to CDP during rasterize; never reachable through the outward
// HTTP layer.

// Per-call overrides for one rasterize, on top of the configured DeviceProfile.
// Debug-only surface — the Device path never sets these; the dashboard preview
// threads them through from its query string.
export type RasterizeOverrides = {
  bitDepth?: 1 | 2 | 4 | 8;
};

export type Renderer = {
  identity(bundle: Bundle): Promise<string>;
  rasterize(bundle: Bundle, overrides?: RasterizeOverrides): Promise<Uint8Array<ArrayBuffer>>;
  origin(): string;
  close(): Promise<void>;
};

export type FetchPngFromUrl = (
  url: string,
  overrides?: RasterizeOverrides,
) => Promise<Uint8Array<ArrayBuffer>>;

export type RendererDeps = {
  fetchPngFromUrl: FetchPngFromUrl;
  // From SystemConfig.loopbackHost. "127.0.0.1" (the seeded default) covers
  // both run modes: compose (chrome shares the deno netns) and dev with a
  // host-networked chrome. Any other value (e.g. "host.docker.internal" for
  // a port-mapped dev chrome) flips the bind to 0.0.0.0 — see the security
  // trade-off comment in createRenderer.
  loopbackHost?: string;
};

const INDEX_PATH = "/index.html";

export function createRenderer(deps: RendererDeps): Renderer {
  let mounted: Bundle | null = null;

  // Single-mount-with-lock: rasterize calls serialise through this promise
  // chain so the loopback never serves the wrong Bundle to a concurrent CDP
  // fetch.
  let chain: Promise<unknown> = Promise.resolve();

  const app = new Hono()
    .get(INDEX_PATH, (c) => {
      if (!mounted) return c.text("no bundle mounted", 503);
      const html = renderToString(
        mounted.result.view(mounted.result.state) as Parameters<typeof renderToString>[0],
      );
      return c.html("<!DOCTYPE html>" + html, 200, { "cache-control": "no-store" });
    })
    .get("/assets/*", (c) => {
      if (!mounted) return c.text("no bundle mounted", 503);
      const path = new URL(c.req.url).pathname;
      const bytes = mounted.assets[path];
      if (!bytes) return c.text("not found", 404);
      // Chrome won't render an SVG inside an <img> unless it's served as
      // image/svg+xml — SVG is deliberately not content-sniffed for <img>.
      const headers: Record<string, string> = { "cache-control": "no-store" };
      const type = contentType(extname(path));
      if (type) headers["content-type"] = type;
      return c.body(bytes, 200, headers);
    });

  // "127.0.0.1" keeps the ephemeral port inside the network namespace —
  // correct whenever chrome shares it (compose netns, host-net dev chrome).
  // Any other host (e.g. "host.docker.internal" for a port-mapped dev
  // chrome) resolves to the host's external IP, so the port must bind
  // 0.0.0.0 and becomes LAN-reachable — acceptable under ADR-0001's
  // single-user trusted-LAN posture.
  const loopbackHost = deps.loopbackHost ?? "127.0.0.1";
  const bindHostname = loopbackHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
  const server = Deno.serve(
    { port: 0, hostname: bindHostname, onListen: () => {} },
    app.fetch,
  );
  const addr = server.addr as Deno.NetAddr;
  const origin = `http://${loopbackHost}:${addr.port}`;

  return {
    identity(bundle) {
      return timed("identity", () => {
        // A Plugin-asserted content identity (Result `hints.identity`) skips
        // HTML render + asset hashing entirely — see ADR-0004 and the trap
        // documented on `ResultHints.identity` (plugin.ts).
        const asserted = bundle.result.hints?.identity;
        return asserted !== undefined ? hash(asserted) : hash(bundlePayload(bundle));
      });
    },
    rasterize(bundle, overrides) {
      const next = timed("rasterize", () =>
        chain
          .catch(() => {})
          .then(async () => {
            mounted = bundle;
            try {
              return await deps.fetchPngFromUrl(`${origin}${INDEX_PATH}`, overrides);
            } finally {
              mounted = null;
            }
          }));
      chain = next;
      return next;
    },
    origin() {
      return origin;
    },
    async close() {
      await server.shutdown();
    },
  };
}

// The default identity payload: HTML derived from `view(state)` concatenated
// with the Bundle's asset bytes. HTML derivation is Renderer-internal per
// ADR-0003, so this lives here rather than in hash.ts (which just hashes
// bytes).
function bundlePayload(bundle: Bundle): Uint8Array<ArrayBuffer> {
  const html = renderToString(
    bundle.result.view(bundle.result.state) as Parameters<typeof renderToString>[0],
  );
  return concatHtmlAndAssets(html, bundle.assets);
}

// Each asset is serialised as `utf8(key) + 0x00 + bytes + 0x00`, so two
// assets with identical bytes but different keys hash differently. Keys are
// processed in sorted order so insertion order doesn't affect the digest.
function concatHtmlAndAssets(
  html: string,
  assets: Record<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const htmlBytes = encoder.encode(html);
  const sortedKeys = [...Object.keys(assets)].sort();
  const keyBytesByKey = new Map<string, Uint8Array>();
  for (const key of sortedKeys) keyBytesByKey.set(key, encoder.encode(key));

  let totalLength = htmlBytes.length;
  for (const key of sortedKeys) {
    totalLength += keyBytesByKey.get(key)!.length + 1 + assets[key].length + 1;
  }

  const out = new Uint8Array(new ArrayBuffer(totalLength));
  out.set(htmlBytes, 0);
  let offset = htmlBytes.length;
  for (const key of sortedKeys) {
    const keyBytes = keyBytesByKey.get(key)!;
    out.set(keyBytes, offset);
    offset += keyBytes.length;
    offset += 1; // 0x00 separator between key and bytes
    out.set(assets[key], offset);
    offset += assets[key].length;
    offset += 1; // 0x00 terminator between entries
  }
  return out;
}

export type FetchPngFromUrlConfig = {
  cdpUrl: string;
  // Omitted → the dither default ("wasm"). Config-selectable so the native
  // pipeline can be A/B'd on the Pi without rebuilding the image.
  ditherEngine?: DitherEngine;
} & DeviceProfile;

export function createFetchPngFromUrl(config: FetchPngFromUrlConfig): FetchPngFromUrl {
  // Resolve the endpoint, open the Astral Browser, and open a Page once.
  // Both live for the Renderer's lifetime; every render reuses the same Page
  // by `goto`-ing to the new URL. Memoized as a Promise so concurrent
  // first-call requests share the same in-flight connect. If Chrome restarts,
  // the cached Page becomes invalid and subsequent renders throw — restart
  // the Deno process to recover.
  //
  // Safe to reuse one Page because `rasterize` serialises calls through its
  // chain; the device-metrics + lifecycle setup is sticky across navigations,
  // and each `goto` fires a fresh FCP for the new loaderId.
  let pagePromise: Promise<Page> | undefined;

  return async (url, overrides) => {
    const page = await timed(
      "page",
      () => (pagePromise ??= (async () => {
        const endpoint = await resolveCdpEndpoint(config.cdpUrl);
        const browser = await connect({ endpoint });
        return await initPage({
          browser,
          deviceWidth: config.width,
          deviceHeight: config.height,
          // TRMNL framework CSS handles CSS-to-physical scaling via
          // `transform: scale(--pixel-ratio)`, so CDP renders at native res / DPR=1.
          deviceScaleFactor: 1,
        });
      })()),
    );

    const raw = await timed("renderUrl", () => renderUrl({ page, url }));
    return await timed("dither", () =>
      dither(raw, {
        bitDepth: overrides?.bitDepth ?? config.bitDepth,
        mode: config.dither,
        engine: config.ditherEngine,
      }));
  };
}
