import { Hono } from "hono";
import { logger } from "hono/logger";
import { setMetric, timing } from "hono/timing";
import { drainSpans, withSpans } from "./telemetry/spans.ts";
import { ACTIVE_PROFILE, CDP_URL, FRIENDLY_ID, LOOPBACK_HOST, PLUGIN_DIR, PORT } from "./config.ts";
import { createConductor } from "./conductor/conductor.ts";
import ErrorView from "./conductor/error-view.tsx";
import { createDashboard } from "./dashboard/dashboard.ts";
import { createFetchPngFromUrl, createRenderer } from "./render/renderer.ts";
import { createPluginManager } from "./plugin/plugin-manager.ts";
import { createSlot } from "./slot/slot.ts";
import { createTelemetry } from "./telemetry/telemetry.ts";
import { createDeviceState } from "./device-state.ts";

async function main() {
  const pluginManager = await createPluginManager({ pluginDir: PLUGIN_DIR });
  console.log(`[plugin] loaded from ${PLUGIN_DIR}`);

  const now = () => Temporal.Now.zonedDateTimeISO();
  const errorView = (err: Error) => ErrorView(err);
  const errorValidity = Temporal.Duration.from({ seconds: 30 });

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
  // Mirror /api/log bodies to stdout so `docker logs` keeps surfacing them;
  // the in-memory ring backs the dashboard's device section.
  const deviceState = createDeviceState({
    now,
    onLog: (entry) => console.log(`[device-log] ${entry.id.toUpperCase()}: ${entry.body}`),
  });

  const conductor = createConductor({
    pluginManager,
    renderer,
    slot,
    telemetry,
    deviceState,
    errorView,
    errorValidity,
    friendlyId: FRIENDLY_ID,
    now,
  });

  const dashboard = createDashboard({
    slot,
    telemetry,
    deviceState,
    conductorApp: conductor.app,
    pluginManager,
    renderer,
    now,
  });

  const app = new Hono()
    .use(timing())
    // Open an ALS span buffer for every request, then drain anything
    // `timed(...)` recorded down the async tree into Server-Timing. Visible
    // in DevTools' Network panel next to the rest of the timing breakdown.
    .use(async (c, next) => {
      await withSpans(async () => {
        await next();
        // Server-Timing is flat; we encode each span's immediate parent in
        // the entry's `desc` field so DevTools shows the relationship inline.
        // Top-level spans get no desc.
        for (const s of drainSpans()) {
          setMetric(c, s.name, s.ms, s.parent ?? undefined);
        }
      });
    })
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
