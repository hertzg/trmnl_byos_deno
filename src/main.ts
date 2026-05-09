import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { join } from "@std/path";
import {
  CDP_URL,
  FRIENDLY_ID,
  INTERNAL_URL_ORIGIN,
  PORT,
  PUBLIC_URL_ORIGIN,
  REFRESH_RATE_SECONDS,
  TEMPLATE_DIR,
  TEMPLATE_SEED_DIR,
} from "./config.ts";
import { renderUrl, resolveCdpEndpoint } from "./render/cdp.ts";
import { type DitherMode, ditherNative } from "./render/dither.ts";
import { loadTemplate, seedTemplateDir } from "./template/loader.ts";
import {
  type DisplayKind,
  type RenderOverrides,
  type RunContext,
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

function buildContext(url: URL, headers: Headers, kind: DisplayKind): RunContext {
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;

  const devW = parseInt(headers.get("width") ?? "", 10);
  const devH = parseInt(headers.get("height") ?? "", 10);
  const panel = Number.isFinite(devW) && devW > 0 && Number.isFinite(devH) && devH > 0
    ? { width: devW, height: devH }
    : null;

  return { kind, url, query, headers, panel };
}

if (TEMPLATE_SEED_DIR) {
  await seedTemplateDir(TEMPLATE_DIR, TEMPLATE_SEED_DIR);
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

const app = new Hono();

app.use(async (c, next) => {
  const t0 = Date.now();
  await next();
  console.log(
    `${c.req.method} ${new URL(c.req.url).pathname} → ${c.res.status} ${Date.now() - t0}ms`,
  );
});

app.onError((err, c) => {
  console.error("[handler]", err);
  return c.json({ error: "internal" }, 500);
});

// Per-request HTML stash. /image.png runs the template once, parks the resulting HTML
// here under a random token, and tells CDP to navigate to /_render/<token>. The browser
// fetching that URL gets the pre-computed HTML back — same single template invocation,
// but the browser sees a real HTTP origin so /assets/* and other server-relative URLs
// resolve naturally (which is the whole reason for going through a URL instead of
// CDP setContent).
const pendingRenders = new Map<string, string>();

app.get("/", async (c) => {
  const dctx = buildContext(new URL(c.req.url), c.req.raw.headers, "preview");
  const { html } = await runTemplate(template, dctx);
  return c.html(html);
});

app.get("/_render/:token", (c) => {
  const html = pendingRenders.get(c.req.param("token") ?? "");
  if (!html) return c.body(null, 404);
  // Don't let any cache layer hold this — token is one-shot per /image.png request.
  return c.html(html, 200, { "cache-control": "no-store" });
});

app.get("/image.png", async (c) => {
  const url = new URL(c.req.url);
  const dctx = buildContext(url, c.req.raw.headers, "device");
  let overrides: RenderOverrides;
  try {
    overrides = parseQueryOverrides(url.searchParams);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
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
    return c.body(png as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
  } finally {
    pendingRenders.delete(token);
  }
});

if (assetsAvailable) {
  app.get("/assets/*", serveStatic({ root: TEMPLATE_DIR }));
}

// Build the URL the device should fetch the image from. PUBLIC_URL_ORIGIN env wins
// (use it behind a reverse proxy); otherwise the device's own request tells us how
// it reached us — Host/X-Forwarded-* headers from the LAN call are exactly what the
// device used to dial in.
function publicOrigin(url: URL, headers: Headers): string {
  if (PUBLIC_URL_ORIGIN) return PUBLIC_URL_ORIGIN;
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? url.host;
  const proto = headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

app.get("/api/setup", (c) => {
  return c.json({
    status: 200,
    api_key: "byos",
    friendly_id: FRIENDLY_ID,
    image_url: `${publicOrigin(new URL(c.req.url), c.req.raw.headers)}/image.png`,
    message: "Welcome",
  });
});

app.get("/api/display", (c) => {
  const t = Date.now();
  // Cache-buster only — render params are now decided by the template's run() at /image.png time.
  return c.json({
    // status MUST be 0 here — firmware switches on it; anything else (incl. 200)
    // falls through and the image is never fetched.
    status: 0,
    image_url: `${publicOrigin(new URL(c.req.url), c.req.raw.headers)}/image.png?t=${t}`,
    filename: `image-${t}`,
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "none",
    // Forces REFRESH_FULL every cycle on TRMNL X — avoids ghosting between dither variants.
    maximum_compatibility: true,
  });
});

app.post("/api/log", async (c) => {
  const body = await c.req.text();
  const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
  console.log(`[device-log] ${id.toUpperCase()}: ${body}`);
  return c.body(null, 204);
});

console.log(`trmnl-byos-deno on :${PORT}`);
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch);
