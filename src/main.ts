import { Application, Router } from "@oak/oak";
import {
  CDP_URL,
  FRIENDLY_ID,
  PORT,
  PUBLIC_URL_ORIGIN,
  REFRESH_RATE_SECONDS,
} from "./config.ts";
import { renderHtml, resolveCdpEndpoint } from "./render/cdp.ts";
import { loadTemplate } from "./render/template.ts";
import { ditherNative } from "./render/dither.ts";

const TEMPLATE_PATH = new URL("../templates/default.html", import.meta.url);

// TRMNL X panel: 1872x1404 at deviceScaleFactor=1.8 → CSS viewport 1040x780 (landscape).
const TRMNL_X_VIEWPORT_W = 1040;
const TRMNL_X_VIEWPORT_H = 780;
const TRMNL_X_PIXEL_RATIO = 1.8;

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
    `${ctx.request.method} ${ctx.request.url.pathname} → ${ctx.response.status} ${Date.now() - t0}ms`,
  );
});

const router = new Router();

router.get("/", async (ctx) => {
  ctx.response.headers.set("content-type", "text/html; charset=utf-8");
  ctx.response.body = await loadTemplate(TEMPLATE_PATH, {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
  });
});

router.get("/image.png", async (ctx) => {
  const html = await loadTemplate(TEMPLATE_PATH, {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
  });
  const endpoint = await resolveCdpEndpoint(CDP_URL);
  const raw = await renderHtml({
    endpoint,
    content: html,
    deviceWidth: TRMNL_X_VIEWPORT_W,
    deviceHeight: TRMNL_X_VIEWPORT_H,
    deviceScaleFactor: TRMNL_X_PIXEL_RATIO,
  });
  const png = await ditherNative(raw as Uint8Array<ArrayBuffer>);
  ctx.response.headers.set("content-type", "image/png");
  ctx.response.body = png;
});

router.get("/api/setup", (ctx) => {
  ctx.response.body = {
    status: 200,
    api_key: "byos",
    friendly_id: FRIENDLY_ID,
    image_url: `${PUBLIC_URL_ORIGIN}/image.png`,
    message: "Welcome",
  };
});

router.get("/api/display", (ctx) => {
  ctx.response.body = {
    // status MUST be 0 here — firmware switches on it, anything else (incl. 200)
    // falls through and the image is never fetched. /api/setup is different,
    // it uses status: 200.
    status: 0,
    image_url: `${PUBLIC_URL_ORIGIN}/image.png?t=${Date.now()}`,
    filename: String(Date.now()),
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "sleep",
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
