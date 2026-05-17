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
import { createSlot } from "./slot/slot.ts";
import { createTelemetry } from "./telemetry/telemetry.ts";

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

  // 4. Single-Image cache (ADR-0004). One slot, shared by Conductor (who
  // pushes new `{ bundle, identity, image }` triples) and Dashboard (who
  // reads `display()` to know the current identity).
  const slot = createSlot({ now });

  // 5. Per-cycle render trace. The Conductor records once per orchestration
  // cycle (after the eager rasterize resolves); the Dashboard reads
  // `latest()` to render the trace strip. One entry, replaced each render.
  const telemetry = createTelemetry();

  // 6. Conductor owns the BYOS surface (/api/setup, /api/display,
  // /api/log) and the identity-keyed render output (/image/<id>.png). On
  // each /api/display poll it orchestrates Plugin → identity → start
  // rasterize → Slot.put, or returns the cached identity if the Slot is
  // still valid (ADR-0004's three tiers).
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

  // 7. Dashboard at /. Reads the Slot in-process to show the current
  // Image; triggers a refill via `conductor.app.request("/api/display")`
  // when the Slot is empty so there is exactly one render path. Reads
  // `telemetry.latest()` to render the trace strip.
  const dashboard = createDashboard({
    slot,
    telemetry,
    conductorApp: conductor.app,
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
    .route("/", dashboard);

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
