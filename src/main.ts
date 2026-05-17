import { join } from "@std/path";
import { Hono } from "hono";
import { logger } from "hono/logger";
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
import { createDashboard } from "./dashboard/dashboard.ts";
import { deriveHtml } from "./render/derive.ts";
import { identityFor } from "./render/identity.ts";
import { createRasterize } from "./render/rasterize.ts";
import { seedPluginDir } from "./plugin/loader.ts";
import { createPluginManager } from "./plugin/plugin-manager.ts";

async function main() {
  // 1. Seed the Plugin directory if requested, then construct the
  // PluginManager. Construction loads the Plugin module + reads its
  // `assets/` folder into memory once; every subsequent run reuses both.
  if (PLUGIN_SEED_DIR) {
    await seedPluginDir(PLUGIN_DIR, PLUGIN_SEED_DIR);
  }
  const pluginManager = await createPluginManager({ pluginDir: PLUGIN_DIR });
  console.log(`[plugin] loaded from ${PLUGIN_DIR}`);

  // 2. Runtime services the Conductor + Dashboard depend on.
  const now = () => Temporal.Now.zonedDateTimeISO();
  const errorView = (err: Error) => ErrorView(err);
  const errorValidity = Temporal.Duration.from({ seconds: 30 });
  const pluginAssetsDir = join(PLUGIN_DIR, "assets");
  const onDeviceLog = (id: string, body: string) =>
    console.log(`[device-log] ${id.toUpperCase()}: ${body}`);

  // 3. CDP-backed url → png. The Device fetches /preview/png on every poll;
  // /preview/png hands CDP a /preview URL and returns the screenshot.
  const fetchPngFromUrl = createRasterize({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE });

  // 4. Conductor owns the BYOS surface (/api/setup, /api/display, /api/log)
  // and the Plugin assets dir. No rasterize step lives here anymore — the
  // Device-facing pixels come from /preview/png on the Dashboard sub-app.
  const conductor = createConductor({
    pluginManager,
    deriveHtml,
    identityFor,
    errorView,
    errorValidity,
    friendlyId: FRIENDLY_ID,
    pluginAssetsDir,
    onDeviceLog,
    now,
  });

  // 5. Dashboard hosts /, /preview, /preview/png. /preview is the page CDP
  // screenshots — the Device-facing render path runs through here too.
  const dashboard = createDashboard({
    derive: conductor.derive,
    fetchPngFromUrl,
    internalOrigin: INTERNAL_URL_ORIGIN,
    now,
  });

  // 6. Parent app: access log + error handler, then compose the sub-apps.
  const app = new Hono()
    .use(logger())
    .onError((err, c) => {
      console.error("[handler]", err);
      return c.json({ error: "internal" }, 500);
    })
    .route("/", conductor.app)
    .route("/", dashboard);

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
