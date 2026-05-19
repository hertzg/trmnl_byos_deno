import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  ACTIVE_PROFILE,
  CDP_URL,
  FRIENDLY_ID,
  LOOPBACK_HOST,
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
import { createSlot } from "./slot/slot.ts";
import { createTelemetry } from "./telemetry/telemetry.ts";

async function main() {
  if (PLUGIN_SEED_DIR) {
    await seedPluginDir(PLUGIN_DIR, PLUGIN_SEED_DIR);
  }
  const pluginManager = await createPluginManager({ pluginDir: PLUGIN_DIR });
  console.log(`[plugin] loaded from ${PLUGIN_DIR}`);

  const now = () => Temporal.Now.zonedDateTimeISO();
  const errorView = (err: Error) => ErrorView(err);
  const errorValidity = Temporal.Duration.from({ seconds: 30 });
  const onDeviceLog = (id: string, body: string) =>
    console.log(`[device-log] ${id.toUpperCase()}: ${body}`);

  const renderer = createRenderer({
    fetchPngFromUrl: createFetchPngFromUrl({ cdpUrl: CDP_URL, ...ACTIVE_PROFILE }),
    loopbackHost: LOOPBACK_HOST,
  });
  const bindNote = LOOPBACK_HOST === "127.0.0.1"
    ? ""
    : ` (bound on 0.0.0.0 because LOOPBACK_HOST=${LOOPBACK_HOST})`;
  console.log(`[renderer] loopback origin ${renderer.origin()}${bindNote}`);

  const slot = createSlot({ now });
  const telemetry = createTelemetry();

  const conductor = createConductor({
    pluginManager,
    renderer,
    slot,
    telemetry,
    errorView,
    errorValidity,
    friendlyId: FRIENDLY_ID,
    onDeviceLog,
    now,
  });

  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: conductor.app,
    pluginManager,
    renderer,
    now,
  });

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
