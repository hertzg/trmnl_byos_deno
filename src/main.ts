import { encodeHex } from "@std/encoding/hex";
import { crypto } from "@std/crypto";
import {
  DEVICE_ACCESS_TOKEN,
  DEVICE_MAC,
  FRIENDLY_ID,
  PORT,
  PUBLIC_URL_ORIGIN,
  REFRESH_RATE_SECONDS,
} from "./config.ts";
import { renderScreenHtml, renderScreenPng, shutdownBrowser } from "./render.ts";
import { pngTo1BitBmp } from "./bmp.ts";

interface CachedImage {
  bmp: Uint8Array;
  hash: string;
  generatedAt: number;
}

let cache: CachedImage | null = null;

async function buildImage(): Promise<CachedImage> {
  const png = await renderScreenPng();
  const bmp = await pngTo1BitBmp(png);
  const digest = await crypto.subtle.digest("SHA-256", bmp);
  const hash = encodeHex(new Uint8Array(digest)).slice(0, 16);
  return { bmp, hash, generatedAt: Date.now() };
}

async function getImage(force = false): Promise<CachedImage> {
  if (!force && cache && Date.now() - cache.generatedAt < REFRESH_RATE_SECONDS * 1000) {
    return cache;
  }
  cache = await buildImage();
  return cache;
}

function isFresh(req: Request): boolean {
  return new URL(req.url).searchParams.get("fresh") === "1";
}

function macFromHeader(req: Request): string | null {
  const id = req.headers.get("id") ?? req.headers.get("ID");
  return id ? id.toUpperCase() : null;
}

function checkMac(req: Request): Response | null {
  const mac = macFromHeader(req);
  if (!mac) return json({ error: "missing ID header" }, 400);
  if (mac !== DEVICE_MAC) {
    console.warn(`[auth] rejected MAC ${mac} (expected ${DEVICE_MAC})`);
    return json({ error: "MAC not allowed" }, 401);
  }
  return null;
}

function checkToken(req: Request): Response | null {
  const t = req.headers.get("access-token") ?? req.headers.get("Access-Token");
  if (!t) return json({ error: "missing access-token" }, 401);
  if (t !== DEVICE_ACCESS_TOKEN) {
    console.warn(`[auth] rejected token for ${macFromHeader(req)}`);
    return json({ error: "invalid access-token" }, 401);
  }
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function routeSetup(req: Request): Promise<Response> {
  const denied = checkMac(req);
  if (denied) return denied;
  console.log(`[setup] ${macFromHeader(req)}`);
  const img = await getImage();
  return json({
    status: 200,
    api_key: DEVICE_ACCESS_TOKEN,
    friendly_id: FRIENDLY_ID,
    image_url: `${PUBLIC_URL_ORIGIN}/image?hash=${img.hash}`,
    message: "Welcome",
  });
}

async function routeDisplay(req: Request): Promise<Response> {
  const denied = checkMac(req) ?? checkToken(req);
  if (denied) return denied;
  const battery = req.headers.get("battery-voltage") ?? "";
  const fw = req.headers.get("fw-version") ?? "";
  const rssi = req.headers.get("rssi") ?? "";
  console.log(`[display] mac=${macFromHeader(req)} battery=${battery} fw=${fw} rssi=${rssi}`);
  const img = await getImage();
  return json({
    status: 200,
    image_url: `${PUBLIC_URL_ORIGIN}/image?hash=${img.hash}`,
    filename: img.hash,
    refresh_rate: REFRESH_RATE_SECONDS,
    reset_firmware: false,
    update_firmware: false,
    firmware_url: "",
    special_function: "sleep",
  });
}

async function routeLog(req: Request): Promise<Response> {
  const denied = checkMac(req) ?? checkToken(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    console.log(`[device-log] ${JSON.stringify(body)}`);
  } catch {
    console.log("[device-log] (no body)");
  }
  return new Response(null, { status: 204 });
}

async function routeImage(req: Request): Promise<Response> {
  const img = await getImage(isFresh(req));
  return new Response(img.bmp, {
    status: 200,
    headers: {
      "content-type": "image/bmp",
      "content-length": String(img.bmp.length),
      "cache-control": "no-cache",
      "x-image-hash": img.hash,
    },
  });
}

// Dev-friendly: PNG version (browsers render it natively, BMP doesn't always)
async function routePreviewPng(req: Request): Promise<Response> {
  const png = await renderScreenPng({ fresh: isFresh(req) });
  return new Response(png, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": "no-cache" },
  });
}

// Dev-friendly: raw rendered HTML, no chromium round-trip — fastest CSS iteration
async function routePreviewHtml(): Promise<Response> {
  const html = await renderScreenHtml();
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const start = Date.now();

  let res: Response;
  try {
    if (method === "GET" && path === "/") {
      res = new Response("trmnl-byos-deno");
    } else if (method === "GET" && path === "/image") {
      res = await routeImage(req);
    } else if (method === "GET" && path === "/preview") {
      res = await routePreviewPng(req);
    } else if (method === "GET" && path === "/preview.html") {
      res = await routePreviewHtml();
    } else if (method === "GET" && path === "/api/setup") {
      res = await routeSetup(req);
    } else if (method === "GET" && path === "/api/display") {
      res = await routeDisplay(req);
    } else if (method === "POST" && path === "/api/log") {
      res = await routeLog(req);
    } else {
      res = json({ error: "not found", path }, 404);
    }
  } catch (err) {
    console.error("[handler] error:", err);
    res = json({ error: "internal" }, 500);
  }

  console.log(`${method} ${path} → ${res.status} (${Date.now() - start}ms)`);
  return res;
}

console.log(`trmnl-byos-deno listening on :${PORT} (device=${DEVICE_MAC})`);

Deno.addSignalListener("SIGINT", async () => {
  console.log("SIGINT, shutting down...");
  await shutdownBrowser();
  Deno.exit(0);
});
Deno.addSignalListener("SIGTERM", async () => {
  console.log("SIGTERM, shutting down...");
  await shutdownBrowser();
  Deno.exit(0);
});

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
