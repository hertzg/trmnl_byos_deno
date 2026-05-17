import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { Bundle } from "../plugin/bundle.ts";
import { hashBundle } from "../hash.ts";
import type { DeviceProfile } from "./profiles.ts";
import { renderUrl, resolveCdpEndpoint } from "./_internal/cdp.ts";
import { ditherNative } from "./_internal/dither.ts";

// The Renderer is the deep module that owns Bundle → Image (ADR-0003,
// CONTEXT.md). Two public render methods, both stateless from the caller's
// perspective:
//
//   identity(bundle) — derives HTML internally, hashes (html + assets),
//     returns the truncated hex digest.
//   rasterize(bundle) — derives HTML internally, mounts the Bundle on the
//     loopback origin, hands CDP a URL on that origin, screenshots, dithers,
//     returns PNG bytes.
//
// In addition to the render methods, the Renderer owns the loopback HTTP
// server CDP fetches from. Construction spins it up on an OS-assigned
// ephemeral port (`Deno.serve({port: 0})`); `close()` shuts it down. The
// default (`loopbackHost = "host.docker.internal"`) binds the port on
// 0.0.0.0 so chrome-in-docker can reach it across the docker bridge —
// LAN-reachable, acceptable under ADR-0001's trusted-single-user-LAN
// posture. Override with `LOOPBACK_HOST=127.0.0.1` (compose mode) to
// restore 127.0.0.1-only binding. `origin()` exposes its base URL for
// diagnostics; the URLs handed to CDP point at this origin and never at
// the outward server.
//
// Concurrency: single-mount-with-lock. `rasterize` calls serialize through a
// promise chain. While one call is in flight, the loopback serves that
// call's Bundle; subsequent calls wait. This is enough for a single-Device
// server; the lock is trivially correct and never serves the wrong Bundle.

export type Renderer = {
  identity(bundle: Bundle): Promise<string>;
  rasterize(bundle: Bundle): Promise<Uint8Array>;
  // The base URL of the loopback origin CDP fetches from
  // (e.g. "http://127.0.0.1:54321"). Stable across calls for one instance;
  // distinct ephemeral ports across instances.
  origin(): string;
  // Shuts down the loopback HTTP server. Tests await this in their finally
  // block so the process doesn't leak listeners; production calls it on
  // shutdown.
  close(): Promise<void>;
};

// CDP fetches `url` and returns the PNG bytes for it, dithered to the
// active panel's bit depth. Exposed as an injection seam so tests don't
// need to spin up CDP.
export type FetchPngFromUrl = (url: string) => Promise<Uint8Array>;

export type RendererDeps = {
  fetchPngFromUrl: FetchPngFromUrl;
  // Hostname used in the URL handed to CDP (and the bind interface for the
  // loopback origin). Defaults to "host.docker.internal" — the common
  // `deno task dev` workflow (deno on the host, chrome in docker, chrome
  // reaches the host across the docker bridge) Just Works without env
  // overrides.
  //
  // Override to "127.0.0.1" for compose mode, where chrome shares the deno
  // container's network namespace. Any value other than "127.0.0.1" also
  // flips the bind to 0.0.0.0 to make the ephemeral port reachable through
  // the configured host; see the implementation comment in `createRenderer`
  // for the security trade-off.
  loopbackHost?: string;
};

// The path CDP fetches on the loopback origin to get the mounted Bundle's
// HTML. Anything is fine — CDP only knows what we hand it. `/index.html` is
// the conventional choice so the URL reads as a real document.
const INDEX_PATH = "/index.html";

export function createRenderer(deps: RendererDeps): Renderer {
  // The Bundle currently being rasterized. `null` between calls. Read by
  // the loopback handlers; written by `rasterize` under the lock.
  let mounted: Bundle | null = null;

  // Single-mount-with-lock: every `rasterize` call awaits the previous
  // call's promise before mounting its own Bundle. This serialises CDP
  // roundtrips through the loopback so the second caller never sees the
  // first caller's HTML.
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
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        // CDP doesn't need a precise content-type to render — it sniffs
        // images and treats CSS by extension — but we leave the header off
        // rather than guess wrong and trip a browser's strict-MIME check.
        "cache-control": "no-store",
      });
    });

  // `Deno.serve` with `port: 0` asks the kernel for an ephemeral port. The
  // returned server exposes `.addr` (the assigned port) and `.shutdown()`
  // (graceful drain on close).
  //
  // Default loopbackHost ("host.docker.internal") targets the common
  // `deno task dev` workflow: deno on the host, chrome in docker, chrome
  // reaches the host via `host.docker.internal`. Because that hostname
  // resolves to the host's external IP, the loopback port has to be bound
  // on 0.0.0.0 instead of 127.0.0.1 — meaning the ephemeral port is
  // reachable from anywhere on the local network. This is the deliberate
  // trade-off: we accept LAN exposure of an ephemeral port serving the
  // current Bundle's HTML/assets under the single-user trusted-LAN posture
  // documented in ADR-0001. Compose mode overrides to "127.0.0.1" (set in
  // docker-compose.yml) because chrome shares the deno container's network
  // namespace there, and the loopback bind keeps the port un-reachable
  // from anything outside the container.
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
      return hashBundle(bundle);
    },
    rasterize(bundle) {
      // Chain off the previous call: when the previous rasterize finishes
      // (success or failure), we mount our Bundle, kick CDP, and return its
      // bytes. `chain` is updated to our own promise so the next caller
      // awaits us in turn.
      const next = chain
        .catch(() => {})
        .then(async () => {
          mounted = bundle;
          try {
            return await deps.fetchPngFromUrl(`${origin}${INDEX_PATH}`);
          } finally {
            mounted = null;
          }
        });
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

// Production CDP fetcher. `main.ts` builds one and hands it to the
// Renderer; `rasterize` calls it with the loopback URL of the mounted
// Bundle.
export type FetchPngFromUrlConfig = {
  cdpUrl: string;
} & DeviceProfile;

export function createFetchPngFromUrl(config: FetchPngFromUrlConfig): FetchPngFromUrl {
  return async (url) => {
    const endpoint = await resolveCdpEndpoint(config.cdpUrl);
    const raw = await renderUrl({
      endpoint,
      url,
      deviceWidth: config.width,
      deviceHeight: config.height,
      // CDP renders at the panel's native resolution with DPR=1; the TRMNL
      // framework CSS handles CSS-to-physical scaling on the page side via
      // `transform: scale(--pixel-ratio)`.
      deviceScaleFactor: 1,
    });
    return await ditherNative(raw as Uint8Array<ArrayBuffer>, {
      bitDepth: config.bitDepth,
      mode: config.dither,
    });
  };
}
