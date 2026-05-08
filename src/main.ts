import { Application, Router } from "@oak/oak";
import { CDP_URL, FRIENDLY_ID, PORT, PUBLIC_URL_ORIGIN, REFRESH_RATE_SECONDS } from "./config.ts";
import { renderHtml, resolveCdpEndpoint } from "./render/cdp.ts";
import { loadTemplate } from "./render/template.ts";
import { type DitherMode, ditherNative } from "./render/dither.ts";

const TEMPLATE_PATH = new URL("../templates/default.html", import.meta.url);

// TRMNL X panel: 1872x1404 at deviceScaleFactor=1.8 → CSS viewport 1040x780 (landscape).
const TRMNL_X_VIEWPORT_W = 1040;
const TRMNL_X_VIEWPORT_H = 780;
const TRMNL_X_PIXEL_RATIO = 1.8;
const TRMNL_X_BIT_DEPTH = 4;

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
  fallback: number,
  min = 1,
  max = 1 << 31,
): number {
  const raw = q.get(key);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`bad ${key}=${raw} (must be int in [${min}, ${max}])`);
  }
  return n;
}

function floatParam(q: URLSearchParams, key: string, fallback: number, min = 0, max = 16): number {
  const raw = q.get(key);
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= min || n > max) {
    throw new Error(`bad ${key}=${raw} (must be float in (${min}, ${max}])`);
  }
  return n;
}

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
  const q = ctx.request.url.searchParams;
  ctx.response.headers.set("content-type", "text/html; charset=utf-8");
  ctx.response.body = await loadTemplate(TEMPLATE_PATH, {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
    DITHER: q.get("dither") ?? "(preview)",
    BIT_DEPTH: q.get("bitDepth") ?? "—",
    WIDTH: q.get("width") ?? String(TRMNL_X_VIEWPORT_W),
    HEIGHT: q.get("height") ?? String(TRMNL_X_VIEWPORT_H),
    DPR: q.get("dpr") ?? String(TRMNL_X_PIXEL_RATIO),
    DEVICE_W: String(
      Math.round(
        (+(q.get("width") ?? TRMNL_X_VIEWPORT_W)) * +(q.get("dpr") ?? TRMNL_X_PIXEL_RATIO),
      ),
    ),
    DEVICE_H: String(
      Math.round(
        (+(q.get("height") ?? TRMNL_X_VIEWPORT_H)) * +(q.get("dpr") ?? TRMNL_X_PIXEL_RATIO),
      ),
    ),
  });
});

router.get("/image.png", async (ctx) => {
  const q = ctx.request.url.searchParams;
  let width: number, height: number, dpr: number, bitDepth: number, dither: DitherMode;
  try {
    width = intParam(q, "width", TRMNL_X_VIEWPORT_W, 1, 8192);
    height = intParam(q, "height", TRMNL_X_VIEWPORT_H, 1, 8192);
    dpr = floatParam(q, "dpr", TRMNL_X_PIXEL_RATIO, 0, 4);
    bitDepth = intParam(q, "bitDepth", TRMNL_X_BIT_DEPTH, 1, 8);
    if (!VALID_BIT_DEPTHS.has(bitDepth)) {
      throw new Error(`bad bitDepth=${bitDepth} (must be 1, 2, 4, or 8)`);
    }
    const ditherRaw = q.get("dither") ?? "floyd-steinberg";
    if (!VALID_DITHER_MODES.includes(ditherRaw as DitherMode)) {
      throw new Error(
        `bad dither=${ditherRaw} (must be one of ${VALID_DITHER_MODES.join(", ")})`,
      );
    }
    dither = ditherRaw as DitherMode;
  } catch (err) {
    ctx.response.status = 400;
    ctx.response.body = { error: err instanceof Error ? err.message : String(err) };
    return;
  }

  const html = await loadTemplate(TEMPLATE_PATH, {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
    DITHER: dither,
    BIT_DEPTH: String(bitDepth),
    WIDTH: String(width),
    HEIGHT: String(height),
    DPR: String(dpr),
    DEVICE_W: String(Math.round(width * dpr)),
    DEVICE_H: String(Math.round(height * dpr)),
  });
  const endpoint = await resolveCdpEndpoint(CDP_URL);
  const raw = await renderHtml({
    endpoint,
    content: html,
    deviceWidth: width,
    deviceHeight: height,
    deviceScaleFactor: dpr,
  });
  const png = await ditherNative(raw as Uint8Array<ArrayBuffer>, {
    bitDepth: bitDepth as 1 | 2 | 4 | 8,
    mode: dither,
  });
  ctx.response.headers.set("content-type", "image/png");
  ctx.response.body = png;
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

// Auto-cycle through dither modes on each /api/display poll. With touchbar_mode unset
// (gesture mode), taps re-poll /api/display, so each tap advances one mode. Persists for
// process lifetime; restart resets.
let displayCycleIdx = 0;

router.get("/api/display", (ctx) => {
  const dither = VALID_DITHER_MODES[displayCycleIdx % VALID_DITHER_MODES.length];
  displayCycleIdx++;
  const t = Date.now();

  const params = new URLSearchParams({ dither, t: String(t) });

  // Honor device-reported panel size. Firmware sends Width/Height as device pixels;
  // we convert to CSS pixels using the TRMNL X DPR assumption (1.8) so the same code
  // works for non-TRMNL-X devices that might poll us.
  const devW = parseInt(ctx.request.headers.get("width") ?? "", 10);
  const devH = parseInt(ctx.request.headers.get("height") ?? "", 10);
  if (Number.isFinite(devW) && devW > 0) {
    params.set("width", String(Math.round(devW / TRMNL_X_PIXEL_RATIO)));
  }
  if (Number.isFinite(devH) && devH > 0) {
    params.set("height", String(Math.round(devH / TRMNL_X_PIXEL_RATIO)));
  }

  ctx.response.body = {
    // status MUST be 0 here — firmware switches on it; anything else (incl. 200)
    // falls through and the image is never fetched.
    status: 0,
    image_url: `${publicOrigin(ctx)}/image.png?${params.toString()}`,
    filename: `${dither}-${t}`,
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
