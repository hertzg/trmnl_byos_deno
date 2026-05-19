import { resolve } from "@std/path";
import { getProfile, profileIds } from "./render/profiles.ts";
import type { DeviceProfile } from "./render/profiles.ts";

function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export const PORT = parseInt(env("PORT", "3000"), 10);
// Empty → use request Host/X-Forwarded-*. Set only behind a reverse proxy.
export const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN", "");
export const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");

export const CDP_URL = env("CDP_URL", "http://localhost:9222");

// Hostname the Renderer hands CDP. Default targets `deno task dev` (chrome
// in docker reaches host via host.docker.internal). Compose mode pins
// "127.0.0.1". See bind-host trade-off in renderer.ts.
export const LOOPBACK_HOST = env("LOOPBACK_HOST", "host.docker.internal");

export const PLUGIN_DIR = resolve(env("PLUGIN_DIR", "./templates/example"));

// Optional bundled-seed dir (baked into the Docker image). When set and
// PLUGIN_DIR is empty, the seed is copied in before loading.
const seedRaw = env("PLUGIN_SEED_DIR", "");
export const PLUGIN_SEED_DIR = seedRaw ? resolve(seedRaw) : "";

export const DEVICE_ID = env("DEVICE_ID", "trmnl-x");

export const ACTIVE_PROFILE: DeviceProfile = (() => {
  const p = getProfile(DEVICE_ID);
  if (!p) {
    throw new Error(
      `unknown DEVICE_ID="${DEVICE_ID}". Known ids: ${profileIds().join(", ")}`,
    );
  }
  return p;
})();
