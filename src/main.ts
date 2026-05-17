import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  ACTIVE_PROFILE,
  CDP_URL,
  FRIENDLY_ID,
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
  const onDeviceLog = (id: string, body: string) =>
    console.log(`[device-log] ${id.toUpperCase()}: ${body}`);

  // 3. Renderer owns its own loopback HTTP origin (ADR-0003, slice #51).
  // Construction spins up a Hono sub-app on an OS-assigned ephemeral port
  // on 127.0.0.1; CDP fetches Bundle HTML + assets from there during
  // rasterize. The Server's outward HTTP layer never serves Plugin assets.
  const renderer = createRenderer({
    fetchPngFromUrl: createFetchPngFromUrl({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE }),
  });
  console.log(`[renderer] loopback origin ${renderer.origin()}`);

  // 4. Conductor owns the BYOS surface (/api/setup, /api/display, /api/log).
  // PluginManager produces a Bundle each run; the Conductor asks the
  // Renderer for the Bundle's identity on every /api/display poll. The
  // Device-facing pixels still come from /preview/png on the Dashboard
  // sub-app for this slice (slice #52 introduces the Slot + /image/<id>).
  const conductor = createConductor({
    pluginManager,
    renderer,
    errorView,
    errorValidity,
    friendlyId: FRIENDLY_ID,
    onDeviceLog,
    now,
  });

  // 5. Dashboard hosts / and /preview/png. /preview/png derives a Bundle
  // via conductor.derive and hands it to renderer.rasterize — CDP fetches
  // Renderer's loopback origin for the HTML, never this outward server.
  const dashboard = createDashboard({
    derive: conductor.derive,
    renderer,
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
