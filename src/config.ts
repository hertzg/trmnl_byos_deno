import { resolve } from "@std/path";
import { getProfile, profileIds } from "./render/profiles.ts";
import type { DeviceProfile } from "./render/profiles.ts";

function env(key: string, fallback = ""): string {
  return Deno.env.get(key) ?? fallback;
}

export const PORT = parseInt(env("PORT", "3000"), 10);
// Empty by default — the request's Host/X-Forwarded-* headers are used. Set this only
// to override (e.g. behind a reverse proxy with a different external hostname).
export const PUBLIC_URL_ORIGIN = env("PUBLIC_URL_ORIGIN", "");
export const FRIENDLY_ID = env("FRIENDLY_ID", "TRMNL");

// HTTP base of the CDP container (cloakhq/cloakbrowser cloakserve). The
// per-process WS endpoint is resolved via /json/version on each render.
// CDP must be able to reach the Renderer's loopback origin (127.0.0.1:<ephemeral>);
// running CDP in the host network namespace (--network host) or with
// `--add-host=host.docker.internal:host-gateway` plus a manual route is the
// usual deployment shape. See ADR-0003 / ADR-0005.
export const CDP_URL = env("CDP_URL", "http://localhost:9222");

// Hostname the Renderer uses in the URL it hands CDP, and (when not
// 127.0.0.1) the bind interface for the loopback origin. Default
// "host.docker.internal" targets the common `deno task dev` workflow
// (deno on the host, chrome in docker, chrome reaches the host across
// the docker bridge) so it Just Works without env overrides. Compose
// mode pins LOOPBACK_HOST=127.0.0.1 in docker-compose.yml because chrome
// shares the deno container's network namespace and the loopback bind
// keeps the ephemeral port un-reachable from outside the container.
// See src/render/renderer.ts for the bind-host security trade-off.
export const LOOPBACK_HOST = env("LOOPBACK_HOST", "host.docker.internal");

// Absolute path to the user's Plugin directory. The directory must contain a
// `main.ts` whose default export is a factory returning a Plugin (ADR-0002).
// Defaults to the bundled example Plugin; bind-mount over this path (or
// override the env var) to ship your own.
export const PLUGIN_DIR = resolve(env("PLUGIN_DIR", "./templates/example"));

// Optional absolute path to a "seed" Plugin (the bundled example, baked into
// the Docker image at /app/plugin-seed). When set and PLUGIN_DIR is empty,
// the service copies the seed in before loading. Empty/unset = no seeding
// (the dev workflow, where PLUGIN_DIR already points at the populated
// example checked into the repo).
const seedRaw = env("PLUGIN_SEED_DIR", "");
export const PLUGIN_SEED_DIR = seedRaw ? resolve(seedRaw) : "";

// Active device profile, resolved from DEVICE_ID at boot via the hardcoded registry
// in src/render/profiles.ts. Adding a device model is a registry entry, not a new
// env var. Unknown id fails fast with the list of valid ids.
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
