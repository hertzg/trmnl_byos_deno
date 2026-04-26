import { launch } from "@astral/astral";

// ---------- env ----------

function env(key: string, fallback?: string): string {
  const v = Deno.env.get(key) ?? fallback;
  if (v == null) throw new Error(`Missing required env var: ${key}`);
  return v;
}

const DEVICE_MAC = env("BYOS_DEVICE_MAC").toUpperCase();
const DEVICE_ACCESS_TOKEN = env("BYOS_DEVICE_ACCESS_TOKEN");
const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN");
const PORT = parseInt(env("PORT", "3000"), 10);
const REFRESH_RATE_SECONDS = parseInt(env("REFRESH_RATE_SECONDS", "300"), 10);
const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");
const ORIENTATION = env("ORIENTATION", "landscape");
const PIXEL_RATIO = parseFloat(env("PIXEL_RATIO", "1.8"));
const IMAGE_BIT_DEPTH = parseInt(env("IMAGE_BIT_DEPTH", "4"), 10);

const VIEWPORT_W = ORIENTATION === "landscape" ? 1040 : 780;
const VIEWPORT_H = ORIENTATION === "landscape" ? 780 : 1040;

const TEMPLATE_PATH = new URL("../templates/default.html", import.meta.url);

// ---------- render ----------

async function renderImage(): Promise<Uint8Array> {
  const template = await Deno.readTextFile(TEMPLATE_PATH);
  const vars: Record<string, string> = {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
  };
  const html = template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");

  const browser = await launch({
    headless: true,
    path: Deno.env.get("ASTRAL_BIN"),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${PIXEL_RATIO}`,
    ],
  });

  let png: Uint8Array;
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
    await new Promise((r) => setTimeout(r, 800));
    png = await page.screenshot({ format: "png" });
  } finally {
    await browser.close();
  }

  const cmd = new Deno.Command("magick", {
    args: [
      "png:-",
      "-colorspace",
      "Gray",
      "-dither",
      "FloydSteinberg",
      "-depth",
      String(IMAGE_BIT_DEPTH),
      "-define",
      `png:bit-depth=${IMAGE_BIT_DEPTH}`,
      "-define",
      "png:color-type=0",
      "-strip",
      "png:-",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const proc = cmd.spawn();
  const w = proc.stdin.getWriter();
  await w.write(png);
  await w.close();
  const { code, stdout, stderr } = await proc.output();
  if (code !== 0) throw new Error(`magick failed: ${new TextDecoder().decode(stderr)}`);
  return stdout;
}

// ---------- routes ----------

function macFromHeader(req: Request): string | null {
  return (req.headers.get("id") ?? req.headers.get("ID"))?.toUpperCase() ?? null;
}

function checkAuth(req: Request, requireToken = false): Response | null {
  const mac = macFromHeader(req);
  if (mac !== DEVICE_MAC) {
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

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname: path } = url;
  const method = req.method;
  const t0 = Date.now();

  let res: Response;
  try {
    if (method === "GET" && path === "/") {
      res = new Response("trmnl-byos-deno");
    } else if (method === "GET" && path === "/image.png") {
      const png = await renderImage();
      res = new Response(png, { headers: { "content-type": "image/png" } });
    } else if (method === "GET" && path === "/api/setup") {
      res = checkAuth(req) ?? Response.json({
        status: 200,
        api_key: DEVICE_ACCESS_TOKEN,
        friendly_id: FRIENDLY_ID,
        image_url: `${PUBLIC_URL_ORIGIN}/image.png`,
        message: "Welcome",
      });
    } else if (method === "GET" && path === "/api/display") {
      const denied = checkAuth(req, true);
      if (denied) {
        res = denied;
      } else {
        console.log(
          `[display] ${macFromHeader(req)} battery=${req.headers.get("battery-voltage") ?? "?"} fw=${req.headers.get("fw-version") ?? "?"}`,
        );
        res = Response.json({
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
    } else if (method === "POST" && path === "/api/log") {
      const denied = checkAuth(req, true);
      if (denied) {
        res = denied;
      } else {
        const body = await req.text();
        console.log(`[device-log] ${body}`);
        res = new Response(null, { status: 204 });
      }
    } else {
      res = Response.json({ error: "not found", path }, { status: 404 });
    }
  } catch (err) {
    console.error("[handler]", err);
    res = Response.json({ error: "internal" }, { status: 500 });
  }

  console.log(`${method} ${path} → ${res.status} (${Date.now() - t0}ms)`);
  return res;
}

console.log(`trmnl-byos-deno listening on :${PORT} (device=${DEVICE_MAC}, ${VIEWPORT_W}x${VIEWPORT_H}@${PIXEL_RATIO}x)`);
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
