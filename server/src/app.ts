import { Hono } from "hono";
import { logger } from "hono/logger";
import { setMetric, timing } from "hono/timing";
import type { SystemConfig } from "@hztrmnl/config/system";
import { drainSpans, withSpans } from "./telemetry/spans.ts";
import { type DeviceProfile, getProfile, profileIds } from "./render/profiles.ts";
import { createConductor } from "./conductor/conductor.ts";
import ErrorView from "./conductor/error-view.tsx";
import { createDashboard } from "./dashboard/dashboard.ts";
import { createFetchPngFromUrl, createRenderer, type FetchPngFromUrl } from "./render/renderer.ts";
import { createPluginManager } from "./plugin/plugin-manager.ts";
import { createSlot } from "./slot/slot.ts";
import { createTelemetry } from "./telemetry/telemetry.ts";
import { createDeviceState } from "./device-state.ts";
import { createDebugApp } from "./debug/debug.ts";
import { createFirmwareOffer } from "./firmware/firmware.ts";
import { type Clock, systemClock } from "./clock.ts";

// Composition root. The entire object graph is built here, from a SystemConfig
// and nothing else — importing this module starts nothing and reads no
// singleton. main.ts calls createApp and serves the returned Hono app; a test
// calls it with its own config, drives it through `app.request(...)`, and
// awaits `shutdown()` to release the Renderer's loopback port.

export type App = {
  app: Hono;
  shutdown(): Promise<void>;
};

// The two process boundaries a test can't own: the wall clock and the browser
// that rasterizes. Both default to the real thing.
export type AppDeps = {
  now?: Clock;
  fetchPngFromUrl?: FetchPngFromUrl;
};

export async function createApp(config: SystemConfig, deps: AppDeps = {}): Promise<App> {
  const now = deps.now ?? systemClock(config.timeZone);
  const profile = requireProfile(config.deviceId);
  return config.debug
    ? debugModeApp(config, profile, now)
    : await pipelineApp(config, profile, now, deps);
}

function requireProfile(deviceId: string): DeviceProfile {
  const profile = getProfile(deviceId);
  if (!profile) {
    throw new Error(
      `unknown deviceId "${deviceId}" in config/live/system.ts. Known ids: ${
        profileIds().join(", ")
      }`,
    );
  }
  return profile;
}

// Debug mode replaces the whole pipeline: no Plugin, no renderer/CDP, no Slot.
// The Device gets exactly what the panel at / configures. Toggled by editing
// config/live/system.ts (webproc) and restarting.
function debugModeApp(
  config: SystemConfig,
  profile: DeviceProfile,
  now: Clock,
): App {
  const deviceState = createDeviceState({ now, onLog: logDeviceEntry });

  const app = baseApp().route(
    "/",
    createDebugApp({
      profile,
      deviceState,
      friendlyId: config.friendlyId,
      publicUrlOrigin: config.publicUrlOrigin,
      now,
    }),
  );

  console.log(
    "[debug] DEBUG MODE — normal pipeline disabled; control panel at / " +
      "(set debug: false in config/live/system.ts to leave)",
  );
  return { app, shutdown: () => Promise.resolve() };
}

async function pipelineApp(
  config: SystemConfig,
  profile: DeviceProfile,
  now: Clock,
  deps: AppDeps,
): Promise<App> {
  const pluginManager = await createPluginManager({
    plugin: config.plugin,
    assetsDir: config.pluginAssetsDir,
  });
  console.log(`[plugin] assets from ${config.pluginAssetsDir}`);

  const renderer = createRenderer({
    fetchPngFromUrl: deps.fetchPngFromUrl ?? createFetchPngFromUrl({
      cdpUrl: config.cdpUrl,
      ditherEngine: config.ditherEngine,
      ...profile,
    }),
    loopbackHost: config.loopbackHost,
  });
  console.log(`[renderer] dither engine ${config.ditherEngine ?? "wasm"}`);
  const bindNote = config.loopbackHost === "127.0.0.1"
    ? ""
    : ` (bound on 0.0.0.0 because loopbackHost=${config.loopbackHost})`;
  console.log(`[renderer] loopback origin ${renderer.origin()}${bindNote}`);

  const slot = createSlot({ now });
  const telemetry = createTelemetry();
  // Mirror /api/log bodies to stdout so `docker logs` keeps surfacing them;
  // the in-memory ring backs the dashboard's device section.
  const deviceState = createDeviceState({ now, onLog: logDeviceEntry });

  // One shared offer: the dashboard loads the release list and arms a
  // version, the Device's next poll spends it. Deliberately not config — it
  // never survives a restart.
  const firmwareOffer = createFirmwareOffer();

  const conductor = createConductor({
    pluginManager,
    renderer,
    slot,
    telemetry,
    deviceState,
    errorView: (err: Error) => ErrorView(err),
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: config.friendlyId,
    publicUrlOrigin: config.publicUrlOrigin,
    now,
    firmwareOffer,
  });

  const dashboard = createDashboard({
    slot,
    telemetry,
    deviceState,
    conductorApp: conductor.app,
    pluginManager,
    renderer,
    now,
    firmwareOffer,
  });

  const app = baseApp()
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
    .route("/", conductor.app)
    .route("/", dashboard);

  return { app, shutdown: () => renderer.close() };
}

function baseApp(): Hono {
  return new Hono()
    .use(logger())
    .onError((err, c) => {
      console.error("[handler]", err);
      return c.json({ error: "internal" }, 500);
    });
}

function logDeviceEntry(entry: { id: string; body: string }): void {
  console.log(`[device-log] ${entry.id.toUpperCase()}: ${entry.body}`);
}
