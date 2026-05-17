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
import { createCdpRasterize } from "./render/cdp-rasterize.ts";
import { createRasterize } from "./render/rasterize.ts";
import { loadPlugin, seedPluginDir } from "./plugin/loader.ts";

async function main() {
  // 1. Seed the Plugin directory if requested, then load the Plugin.
  if (PLUGIN_SEED_DIR) {
    await seedPluginDir(PLUGIN_DIR, PLUGIN_SEED_DIR);
  }
  const plugin = await loadPlugin(PLUGIN_DIR);
  console.log(`[plugin] loaded from ${PLUGIN_DIR}`);

  // 2. Runtime services the Conductor depends on.
  const now = () => Temporal.Now.zonedDateTimeISO();
  const errorView = (err: Error) => ErrorView(err);
  const errorValidity = Temporal.Duration.from({ seconds: 30 });
  const pluginAssetsDir = join(PLUGIN_DIR, "assets");
  const onDeviceLog = (id: string, body: string) =>
    console.log(`[device-log] ${id.toUpperCase()}: ${body}`);

  // 3. Rasterizer chain: URL-fetching CDP backend → shelf-backed bridge that
  // exposes Conductor's (html, hints) → png API and owns the /__internal/render
  // sub-app CDP fetches from.
  const fetchPngFromUrl = createRasterize({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE });
  const cdp = createCdpRasterize({ origin: INTERNAL_URL_ORIGIN, fetchPngFromUrl });

  // 4. Renderer pair (pure functions; no instance state).
  const renderer = { deriveHtml, rasterize: cdp.rasterize };

  // 5. Conductor wires the Plugin, Renderer, and BYOS surface together and
  // exposes its own Hono sub-app.
  const conductor = createConductor({
    plugin,
    renderer,
    identityFor,
    errorView,
    errorValidity,
    friendlyId: FRIENDLY_ID,
    pluginAssetsDir,
    onDeviceLog,
    now,
  });

  // 6. Dashboard: peer sub-app that reads Current state and drives Plugin
  // scrubs via the Conductor's small `scrub` + `committedState` surface.
  const dashboard = createDashboard({
    derive: conductor.derive,
    render: conductor.render,
    committedState: conductor.committedState,
    now,
  });

  // 7. Parent app: access log + error handler, then compose the sub-apps.
  const app = new Hono()
    .use(logger())
    .onError((err, c) => {
      console.error("[handler]", err);
      return c.json({ error: "internal" }, 500);
    })
    .route("/", conductor.app)
    .route("/", cdp.app)
    .route("/", dashboard);

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
