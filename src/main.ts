import {
  DEVICE_ACCESS_TOKEN,
  DEVICE_MAC,
  FRIENDLY_ID,
  PORT,
  PUBLIC_URL_ORIGIN,
  REFRESH_RATE_SECONDS,
} from "./config.ts";
import { renderTemplateToPng } from "./render.ts";
import { pngToGrayscalePng } from "./image.ts";

type Ctx = Record<string, string>;

function macFromHeader(req: Request): string | null {
  return (req.headers.get("id") ?? req.headers.get("ID"))?.toUpperCase() ?? null;
}

function checkAuth(req: Request, ctx: Ctx, requireToken = false): Response | null {
  const mac = macFromHeader(req);
  ctx.id = mac ?? "(none)";

  if (mac !== DEVICE_MAC) {
    //ctx.deny = `mac!=${DEVICE_MAC}`;
    //return Response.json({ error: "MAC not allowed" }, { status: 401 });
  }

  if (requireToken) {
    const t = req.headers.get("access-token") ?? req.headers.get("Access-Token");
    ctx.token = !t ? "(none)" : t === DEVICE_ACCESS_TOKEN ? "ok" : "bad";
    // if (!t) {
    //   ctx.deny = "no-token";
    //   return Response.json({ error: "missing access-token" }, { status: 401 });
    // }
    // if (t !== DEVICE_ACCESS_TOKEN) {
    //   ctx.deny = "bad-token";
    //   return Response.json({ error: "invalid access-token" }, { status: 401 });
    // }
  }
  return null;
}

function deviceTelemetry(req: Request, ctx: Ctx): void {
  const battery = req.headers.get("battery-voltage");
  const fw = req.headers.get("fw-version");
  const rssi = req.headers.get("rssi");
  if (battery) ctx.battery = battery;
  if (fw) ctx.fw = fw;
  if (rssi) ctx.rssi = rssi;
}

async function routeImage(ctx: Ctx): Promise<Response> {
  const t = Date.now();
  const raw = await renderTemplateToPng();
  ctx.render_ms = String(Date.now() - t);
  const png = await pngToGrayscalePng(raw);
  ctx.bytes = String(png.length);
  return new Response(png, { headers: { "content-type": "image/png" } });
}

function routeSetup(req: Request, ctx: Ctx): Response {
  return checkAuth(req, ctx) ?? Response.json({
    status: 200,
    api_key: DEVICE_ACCESS_TOKEN,
    friendly_id: FRIENDLY_ID,
    image_url: `${PUBLIC_URL_ORIGIN}/image.png`,
    message: "Welcome",
  });
}

function routeDisplay(req: Request, ctx: Ctx): Response {
  const denied = checkAuth(req, ctx, true);
  if (denied) return denied;
  deviceTelemetry(req, ctx);
  return Response.json({
    status: 200,
    image_url: `${PUBLIC_URL_ORIGIN}/image.png?t=${Date.now()}`,
    filename: String(Date.now()),
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "sleep",
  });
}

async function routeLog(req: Request, ctx: Ctx): Promise<Response> {
  const denied = checkAuth(req, ctx, true);
  if (denied) return denied;
  const body = await req.text();
  ctx.body_bytes = String(body.length);
  console.log(`[device-log] ${ctx.id}: ${body}`);
  return new Response(null, { status: 204 });
}

async function dispatch(req: Request, path: string, ctx: Ctx): Promise<Response> {
  if (req.method === "GET" && path === "/") return new Response("trmnl-byos-deno");
  if (req.method === "GET" && path === "/image.png") return await routeImage(ctx);
  if (req.method === "GET" && path === "/api/setup") return routeSetup(req, ctx);
  if (req.method === "GET" && path === "/api/display") return routeDisplay(req, ctx);
  if (req.method === "POST" && path === "/api/log") return await routeLog(req, ctx);
  return Response.json({ error: "not found", path }, { status: 404 });
}

function formatCtx(ctx: Ctx): string {
  const entries = Object.entries(ctx);
  if (entries.length === 0) return "";
  return " | " + entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

async function handler(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const t0 = Date.now();
  const ctx: Ctx = {};

  let res: Response;
  try {
    res = await dispatch(req, path, ctx);
  } catch (err) {
    console.error("[handler]", err);
    ctx.error = err instanceof Error ? err.message : String(err);
    res = Response.json({ error: "internal" }, { status: 500 });
  }

  console.log(`${req.method} ${path} → ${res.status} ${Date.now() - t0}ms${formatCtx(ctx)}`);
  return res;
}

console.log(`trmnl-byos-deno on :${PORT} (device=${DEVICE_MAC})`);
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
