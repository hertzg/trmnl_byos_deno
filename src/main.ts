import { join } from "@std/path";
import {
  ACTIVE_PROFILE,
  CDP_URL,
  FRIENDLY_ID,
  INTERNAL_URL_ORIGIN,
  PLUGIN_DIR,
  PLUGIN_SEED_DIR,
  PORT,
} from "./config.ts";
import { createConductor } from "./conductor/conductor.ts";
import ErrorView from "./conductor/error-view.tsx";
import { deriveHtml } from "./render/derive.ts";
import { identityFor } from "./render/identity.ts";
import { createCdpRasterize } from "./render/cdp-rasterize.ts";
import { createRasterize } from "./render/rasterize.ts";
import { loadPlugin, seedPluginDir } from "./plugin/loader.ts";
import { Hono } from "hono";
import { requestId, type RequestIdVariables } from "hono/request-id";

async function main() {
  if (PLUGIN_SEED_DIR) {
    await seedPluginDir(PLUGIN_DIR, PLUGIN_SEED_DIR);
  }

  const plugin = await loadPlugin(PLUGIN_DIR);
  console.log(`[plugin] loaded from ${PLUGIN_DIR}`);

  const cdp = createCdpRasterize({
    origin: INTERNAL_URL_ORIGIN,
    fetchPngFromUrl: createRasterize({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE }),
  });

  const conductor = createConductor({
    plugin,
    renderer: { deriveHtml, rasterize: cdp.rasterize },
    identityFor,
    errorView: (err) => ErrorView(err),
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: FRIENDLY_ID,
    pluginAssetsDir: join(PLUGIN_DIR, "assets"),
    onDeviceLog: (id, body) => console.log(`[device-log] ${id.toUpperCase()}: ${body}`),
    now: () => Temporal.Now.zonedDateTimeISO(),
  });

  const app = new Hono<{ Variables: RequestIdVariables }>();

  // requestId() must run first so the access logger and onError can both
  // read c.get("requestId"). It also sets the X-Request-Id response header
  // for client-side correlation.
  app.use("*", requestId());
  app.use("*", async (c, next) => {
    const t0 = Date.now();
    await next();
    const id = c.get("requestId");
    console.log(
      `[${id}] ${c.req.method} ${new URL(c.req.url).pathname} → ${c.res.status} ${
        Date.now() - t0
      }ms`,
    );
  });

  app.onError((err, c) => {
    const id = c.get("requestId");
    console.error(`[${id}] [handler]`, err);
    return c.json({ error: "internal", requestId: id }, 500);
  });

  app
    .route("/", conductor)
    .route("/", cdp.app);

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
