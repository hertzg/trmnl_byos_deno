import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { contentType } from "@std/media-types";
import { extname } from "@std/path";
import type { Bundle } from "../plugin/bundle.ts";
import { hashBundle } from "../hash.ts";
import type { DeviceProfile } from "./profiles.ts";
import { connect } from "@astral/astral";
import { initPage, type Page, renderUrl, resolveCdpEndpoint } from "./_internal/cdp.ts";
import { dither } from "./_internal/dither.ts";
import { timed } from "../telemetry/spans.ts";

// Renderer: Bundle → Image. See ADR-0003 / CONTEXT.md.
// Owns a loopback HTTP origin that serves the mounted Bundle's HTML +
// assets to CDP during rasterize; never reachable through the outward
// HTTP layer.

export type Renderer = {
  identity(bundle: Bundle): Promise<string>;
  rasterize(bundle: Bundle): Promise<Uint8Array<ArrayBuffer>>;
  origin(): string;
  close(): Promise<void>;
};

export type FetchPngFromUrl = (url: string) => Promise<Uint8Array<ArrayBuffer>>;

export type RendererDeps = {
  fetchPngFromUrl: FetchPngFromUrl;
  // Defaults to "host.docker.internal" so `deno task dev` (deno on host,
  // chrome in docker) Just Works. Compose mode pins "127.0.0.1". Any value
  // other than "127.0.0.1" flips the bind to 0.0.0.0 — see the security
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

  // Default loopback ("host.docker.internal") targets `deno task dev`:
  // chrome-in-docker reaches the deno host via host.docker.internal, which
  // resolves to the host's external IP — so the ephemeral port must be
  // bound on 0.0.0.0 and is therefore LAN-reachable. Acceptable under
  // ADR-0001's single-user trusted-LAN posture. Compose mode overrides to
  // "127.0.0.1" so the port stays inside the container's network namespace.
  const loopbackHost = deps.loopbackHost ?? "host.docker.internal";
  const bindHostname = loopbackHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
  const server = Deno.serve(
    { port: 0, hostname: bindHostname, onListen: () => {} },
    app.fetch,
  );
  const addr = server.addr as Deno.NetAddr;
  const origin = `http://${loopbackHost}:${addr.port}`;

  return {
    identity(bundle) {
      return timed("identity", () => hashBundle(bundle));
    },
    rasterize(bundle) {
      const next = timed("rasterize", () =>
        chain
          .catch(() => {})
          .then(async () => {
            mounted = bundle;
            try {
              return await deps.fetchPngFromUrl(`${origin}${INDEX_PATH}`);
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

export type FetchPngFromUrlConfig = {
  cdpUrl: string;
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

  return async (url) => {
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
        bitDepth: config.bitDepth,
        mode: config.dither,
      }));
  };
}
