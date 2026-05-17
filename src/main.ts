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
import { createFetchPngFromUrl, createRenderer } from "./render/renderer.ts";
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

  // 3. CDP-backed url → png. Built once and threaded into both the Renderer
  // (so Renderer.rasterize can resolve a Bundle to PNG bytes via CDP) and
  // the Dashboard (whose /preview/png scrub path passes through the same
  // fetcher with the caller's ?t=/?intent= query). Slice #54 collapses the
  // dashboard side onto Renderer.rasterize directly.
  const fetchPngFromUrl = createFetchPngFromUrl({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE });

  const renderer = createRenderer({
    internalOrigin: INTERNAL_URL_ORIGIN,
    fetchPngFromUrl,
  });

  // 4. Conductor owns the BYOS surface (/api/setup, /api/display, /api/log)
  // and the Plugin assets dir. PluginManager produces a Bundle each run;
  // the Conductor asks the Renderer for the Bundle's identity on every
  // /api/display poll. The Device-facing pixels still come from /preview/png
  // on the Dashboard sub-app for this slice.
  const conductor = createConductor({
    pluginManager,
    renderer,
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
