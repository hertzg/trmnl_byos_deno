import { Application, Router, send } from "@oak/oak";
import { join } from "@std/path";
import {
  CDP_URL,
  FRIENDLY_ID,
  INTERNAL_URL_ORIGIN,
  PORT,
  PUBLIC_URL_ORIGIN,
  REFRESH_RATE_SECONDS,
  TEMPLATE_DIR,
} from "./config.ts";
import { renderUrl, resolveCdpEndpoint } from "./render/cdp.ts";
import { type DitherMode, ditherNative } from "./render/dither.ts";
import { loadTemplate } from "./template/loader.ts";
import {
  type RunContext,
  type DisplayKind,
  type RenderOverrides,
  runTemplate,
} from "./template/run.ts";

const VALID_BIT_DEPTHS = new Set([1, 2, 4, 8]);
const VALID_DITHER_MODES: DitherMode[] = [
  "floyd-steinberg",
  "atkinson",
  "sierra3",
  "bayer",
  "none",
];

function intParam(
  q: URLSearchParams,
  key: string,
  min = 1,
  max = 1 << 31,
): number | undefined {
  const raw = q.get(key);
  if (raw == null) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`bad ${key}=${raw} (must be int in [${min}, ${max}])`);
  }
  return n;
}

function floatParam(
  q: URLSearchParams,
  key: string,
  min = 0,
  max = 16,
): number | undefined {
  const raw = q.get(key);
  if (raw == null) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= min || n > max) {
    throw new Error(`bad ${key}=${raw} (must be float in (${min}, ${max}])`);
  }
  return n;
}

// Parse query-string render overrides off /image.png (debug knobs). Anything not specified
// stays undefined so the run()-level / service-level defaults can fill it in.
function parseQueryOverrides(q: URLSearchParams): RenderOverrides {
  const overrides: RenderOverrides = {};
  const w = intParam(q, "width", 1, 8192);
  if (w !== undefined) overrides.width = w;
  const h = intParam(q, "height", 1, 8192);
  if (h !== undefined) overrides.height = h;
  const dpr = floatParam(q, "dpr", 0, 4);
  if (dpr !== undefined) overrides.dpr = dpr;
  const bd = intParam(q, "bitDepth", 1, 8);
  if (bd !== undefined) {
    if (!VALID_BIT_DEPTHS.has(bd)) {
      throw new Error(`bad bitDepth=${bd} (must be 1, 2, 4, or 8)`);
    }
    overrides.bitDepth = bd as 1 | 2 | 4 | 8;
  }
  const dither = q.get("dither");
  if (dither !== null) {
    if (!VALID_DITHER_MODES.includes(dither as DitherMode)) {
      throw new Error(`bad dither=${dither} (must be one of ${VALID_DITHER_MODES.join(", ")})`);
    }
    overrides.dither = dither as DitherMode;
  }
  return overrides;
}

function buildContext(req: { url: URL; headers: Headers }, kind: DisplayKind): RunContext {
  const query: Record<string, string> = {};
  for (const [k, v] of req.url.searchParams) query[k] = v;

  const devW = parseInt(req.headers.get("width") ?? "", 10);
  const devH = parseInt(req.headers.get("height") ?? "", 10);
  const panel = Number.isFinite(devW) && devW > 0 && Number.isFinite(devH) && devH > 0
    ? { width: devW, height: devH }
    : null;

  return { kind, url: req.url, query, headers: req.headers, panel };
}

const template = await loadTemplate(TEMPLATE_DIR);
console.log(`[template] loaded from ${TEMPLATE_DIR}`);

// Probe for an assets/ subdirectory once at boot. If it exists, /assets/* serves files
// from it; otherwise the route 404s.
const assetsDir = join(TEMPLATE_DIR, "assets");
let assetsAvailable = false;
try {
  const stat = await Deno.stat(assetsDir);
  assetsAvailable = stat.isDirectory;
} catch {
  assetsAvailable = false;
}
if (assetsAvailable) console.log(`[assets] serving /assets/* from ${assetsDir}`);

const app = new Application();

app.use(async (ctx, next) => {
  const t0 = Date.now();
  try {
    await next();
  } catch (err) {
    console.error("[handler]", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "internal" };
  }
  console.log(
    `${ctx.request.method} ${ctx.request.url.pathname} → ${ctx.response.status} ${
      Date.now() - t0
    }ms`,
  );
});

const router = new Router();

router.get("/", async (ctx) => {
  const dctx = buildContext(ctx.request, "preview");
  const { html } = await runTemplate(template, dctx);
  ctx.response.headers.set("content-type", "text/html; charset=utf-8");
  ctx.response.body = html;
});

// Per-request HTML stash. /image.png runs the template once, parks the resulting HTML
// here under a random token, and tells CDP to navigate to /_render/<token>. The browser
// fetching that URL gets the pre-computed HTML back — same single template invocation,
// but the browser sees a real HTTP origin so /assets/* and other server-relative URLs
// resolve naturally (which is the whole reason for going through a URL instead of
// CDP setContent).
const pendingRenders = new Map<string, string>();

router.get("/_render/:token", (ctx) => {
  const html = pendingRenders.get(ctx.params.token ?? "");
  if (!html) {
    ctx.response.status = 404;
    return;
  }
  ctx.response.headers.set("content-type", "text/html; charset=utf-8");
  // Don't let any cache layer hold this — token is one-shot per /image.png request.
  ctx.response.headers.set("cache-control", "no-store");
  ctx.response.body = html;
});

router.get("/image.png", async (ctx) => {
  const dctx = buildContext(ctx.request, "device");
  let overrides: RenderOverrides;
  try {
    overrides = parseQueryOverrides(ctx.request.url.searchParams);
  } catch (err) {
    ctx.response.status = 400;
    ctx.response.body = { error: err instanceof Error ? err.message : String(err) };
    return;
  }

  const { html, render } = await runTemplate(template, dctx, overrides);
  const token = crypto.randomUUID();
  pendingRenders.set(token, html);
  try {
    const endpoint = await resolveCdpEndpoint(CDP_URL);
    const raw = await renderUrl({
      endpoint,
      url: `${INTERNAL_URL_ORIGIN}/_render/${token}`,
      deviceWidth: render.width,
      deviceHeight: render.height,
      deviceScaleFactor: render.dpr,
    });
    const png = await ditherNative(raw as Uint8Array<ArrayBuffer>, {
      bitDepth: render.bitDepth,
      mode: render.dither,
    });
    ctx.response.headers.set("content-type", "image/png");
    ctx.response.body = png;
  } finally {
    pendingRenders.delete(token);
  }
});

router.get("/assets/:path*", async (ctx) => {
  if (!assetsAvailable) {
    ctx.response.status = 404;
    return;
  }
  const sub = ctx.params.path ?? "";
  await send(ctx, sub, { root: assetsDir });
});

// Build the URL the device should fetch the image from. PUBLIC_URL_ORIGIN env wins
// (use it behind a reverse proxy); otherwise the device's own request tells us how
// it reached us — Host/X-Forwarded-* headers from the LAN call are exactly what the
// device used to dial in.
function publicOrigin(ctx: { request: { url: URL; headers: Headers } }): string {
  if (PUBLIC_URL_ORIGIN) return PUBLIC_URL_ORIGIN;
  const h = ctx.request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? ctx.request.url.host;
  const proto = h.get("x-forwarded-proto") ?? ctx.request.url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

router.get("/api/setup", (ctx) => {
  ctx.response.body = {
    status: 200,
    api_key: "byos",
    friendly_id: FRIENDLY_ID,
    image_url: `${publicOrigin(ctx)}/image.png`,
    message: "Welcome",
  };
});

router.get("/api/display", (ctx) => {
  const t = Date.now();
  // Cache-buster only — render params are now decided by the template's run() at /image.png time.
  ctx.response.body = {
    // status MUST be 0 here — firmware switches on it; anything else (incl. 200)
    // falls through and the image is never fetched.
    status: 0,
    image_url: `${publicOrigin(ctx)}/image.png?t=${t}`,
    filename: `image-${t}`,
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "none",
    // Forces REFRESH_FULL every cycle on TRMNL X — avoids ghosting between dither variants.
    maximum_compatibility: true,
  };
});

router.post("/api/log", async (ctx) => {
  const body = await ctx.request.body.text();
  const id = ctx.request.headers.get("id") ?? ctx.request.headers.get("ID") ?? "(none)";
  console.log(`[device-log] ${id.toUpperCase()}: ${body}`);
  ctx.response.status = 204;
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log(`trmnl-byos-deno on :${PORT}`);
await app.listen({ port: PORT, hostname: "0.0.0.0" });
