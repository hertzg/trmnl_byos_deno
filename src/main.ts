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

  app
    .route("/", conductor.app)
    .route("/", cdp.app);

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
