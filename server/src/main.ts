import { Hono } from "hono";
import { logger } from "hono/logger";
import { setMetric, timing } from "hono/timing";
import { drainSpans, withSpans } from "./telemetry/spans.ts";
import { system } from "@hztrmnl/config/system";
import { getProfile, profileIds } from "./render/profiles.ts";
import type { DeviceProfile } from "./render/profiles.ts";
import { createConductor } from "./conductor/conductor.ts";
import ErrorView from "./conductor/error-view.tsx";
import { createDashboard } from "./dashboard/dashboard.ts";
import { createFetchPngFromUrl, createRenderer } from "./render/renderer.ts";
import { createPluginManager } from "./plugin/plugin-manager.ts";
import { createSlot } from "./slot/slot.ts";
import { createTelemetry } from "./telemetry/telemetry.ts";
import { createDeviceState } from "./device-state.ts";

const ACTIVE_PROFILE: DeviceProfile = (() => {
  const p = getProfile(system.deviceId);
  if (!p) {
    throw new Error(
      `unknown deviceId "${system.deviceId}" in config/live/system.ts. Known ids: ${
        profileIds().join(", ")
      }`,
    );
  }
  return p;
})();

async function main() {
  const pluginManager = await createPluginManager({
    plugin: system.plugin,
    assetsDir: system.pluginAssetsDir,
  });
  console.log(`[plugin] assets from ${system.pluginAssetsDir}`);

  const now = () => Temporal.Now.zonedDateTimeISO();
  const errorView = (err: Error) => ErrorView(err);
  const errorValidity = Temporal.Duration.from({ seconds: 30 });

  const renderer = createRenderer({
    fetchPngFromUrl: createFetchPngFromUrl({
      cdpUrl: system.cdpUrl,
      ditherEngine: system.ditherEngine,
      ...ACTIVE_PROFILE,
    }),
    loopbackHost: system.loopbackHost,
  });
  console.log(`[renderer] dither engine ${system.ditherEngine ?? "wasm"}`);
  const bindNote = system.loopbackHost === "127.0.0.1"
    ? ""
    : ` (bound on 0.0.0.0 because loopbackHost=${system.loopbackHost})`;
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
    friendlyId: system.friendlyId,
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

  console.log(`trmnl-byos-deno on :${system.port}`);
  await Deno.serve({ port: system.port, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
