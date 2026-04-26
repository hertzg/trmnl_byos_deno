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

function macFromHeader(req: Request): string | null {
  return (req.headers.get("id") ?? req.headers.get("ID"))?.toUpperCase() ?? null;
}

function checkAuth(req: Request, requireToken = false): Response | null {
  if (macFromHeader(req) !== DEVICE_MAC) {
    return Response.json({ error: "MAC not allowed" }, { status: 401 });
  }
  if (requireToken) {
    const t = req.headers.get("access-token") ?? req.headers.get("Access-Token");
    if (t !== DEVICE_ACCESS_TOKEN) {
      return Response.json({ error: "invalid access-token" }, { status: 401 });
    }
  }
  return null;
}

async function routeImage(): Promise<Response> {
  const png = await pngToGrayscalePng(await renderTemplateToPng());
  return new Response(png, { headers: { "content-type": "image/png" } });
}

function routeSetup(req: Request): Response {
  return checkAuth(req) ?? Response.json({
    status: 200,
    api_key: DEVICE_ACCESS_TOKEN,
    friendly_id: FRIENDLY_ID,
    image_url: `${PUBLIC_URL_ORIGIN}/image.png`,
    message: "Welcome",
  });
}

function routeDisplay(req: Request): Response {
  const denied = checkAuth(req, true);
  if (denied) return denied;
  console.log(
    `[display] ${macFromHeader(req)} battery=${req.headers.get("battery-voltage") ?? "?"} fw=${req.headers.get("fw-version") ?? "?"}`,
  );
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

async function routeLog(req: Request): Promise<Response> {
  const denied = checkAuth(req, true);
  if (denied) return denied;
  console.log(`[device-log] ${await req.text()}`);
  return new Response(null, { status: 204 });
}

async function handler(req: Request): Promise<Response> {
  const { pathname: path } = new URL(req.url);
  const t0 = Date.now();
  const log = (res: Response) => {
    console.log(`${req.method} ${path} → ${res.status} (${Date.now() - t0}ms)`);
    return res;
  };

  try {
    if (req.method === "GET" && path === "/") return log(new Response("trmnl-byos-deno"));
    if (req.method === "GET" && path === "/image.png") return log(await routeImage());
    if (req.method === "GET" && path === "/api/setup") return log(routeSetup(req));
    if (req.method === "GET" && path === "/api/display") return log(routeDisplay(req));
    if (req.method === "POST" && path === "/api/log") return log(await routeLog(req));
    return log(Response.json({ error: "not found", path }, { status: 404 }));
  } catch (err) {
    console.error("[handler]", err);
    return log(Response.json({ error: "internal" }, { status: 500 }));
  }
}

console.log(`trmnl-byos-deno on :${PORT} (device=${DEVICE_MAC})`);
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
