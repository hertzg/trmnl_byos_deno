import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { join } from "@std/path";
import {
  CDP_URL,
  FRIENDLY_ID,
  INTERNAL_URL_ORIGIN,
  PORT,
  REFRESH_RATE_SECONDS,
  RENDER_DEFAULTS,
  TEMPLATE_DIR,
  TEMPLATE_SEED_DIR,
} from "./config.ts";
import { buildOnDisplayContext, publicOrigin } from "./http/request.ts";
import { createServices, PREVIEW_PATH } from "./services/index.ts";
import { loadTemplate, seedTemplateDir } from "./template/loader.ts";
import ErrorCard from "./template/error-card.tsx";

if (TEMPLATE_SEED_DIR) {
  await seedTemplateDir(TEMPLATE_DIR, TEMPLATE_SEED_DIR);
}

const services = createServices({
  cdpUrl: CDP_URL,
  internalUrlOrigin: INTERNAL_URL_ORIGIN,
  ...RENDER_DEFAULTS,
});

const template = await loadTemplate(TEMPLATE_DIR);
console.log(`[template] loaded from ${TEMPLATE_DIR}`);
const { onDisplay } = await template.setup(services);

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

// Internal CDP-fetches-back-HTML seam. services.renderJsx stashes the rendered HTML
// under a UUID, hands CDP the URL, and the browser fetches it back here. The stash
// key space (UUID) is distinct from the device-facing token (sha-256 hex on /render).
app.get(`${PREVIEW_PATH}/:stashKey`, (c) => {
  const html = services.htmlForStash(c.req.param("stashKey") ?? "");
  if (!html) return c.body(null, 404);
  return c.html(html, 200, { "cache-control": "no-store" });
});

// Device-facing image endpoint. Token is in the URL — no process state, no
// cache-buster needed (each token is unique to the bytes it points at).
app.get("/render/:token", (c) => {
  const bytes = services.bytesFor(c.req.param("token") ?? "");
  if (!bytes) return c.body(null, 404);
  return c.body(bytes as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
});

if (assetsAvailable) {
  app.get("/assets/*", serveStatic({ root: TEMPLATE_DIR }));
}

app.get("/api/setup", (c) => {
  return c.json({
    status: 200,
    api_key: "byos",
    friendly_id: FRIENDLY_ID,
    // No frame to point at yet — the device proceeds to /api/display next, which
    // resolves to a real token. This URL 404s if the device fetches it; firmware
    // recovers via the next /api/display poll.
    image_url: `${publicOrigin(c)}/render/setup`,
    message: "Welcome",
  });
});

app.get("/api/display", async (c) => {
  const ctx = buildOnDisplayContext(c);
  let token: string;
  let refreshAfter: number;
  try {
    const result = await onDisplay(ctx);
    token = result.token;
    refreshAfter = result.refreshAfter;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[onDisplay]", err);
    // Surface the failure to the device via an error frame. If renderJsx itself fails
    // (e.g., CDP is down), onError returns a 500 and firmware skips the image fetch;
    // logs are the source of truth.
    token = await services.renderJsx(ErrorCard({ message }));
    refreshAfter = REFRESH_RATE_SECONDS;
  }
  return c.json({
    // status MUST be 0 here — firmware switches on it; anything else (incl. 200)
    // falls through and the image is never fetched.
    status: 0,
    image_url: `${publicOrigin(c)}/render/${token}`,
    filename: `image-${token}`,
    refresh_rate: refreshAfter,
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
