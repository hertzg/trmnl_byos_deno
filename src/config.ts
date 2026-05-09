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
export const CDP_URL = env("CDP_URL", "http://localhost:9222");

// URL origin the headless browser uses to fetch our HTML for rasterization. Must be
// reachable from CDP's network namespace, which is almost never 127.0.0.1 — chrome
// typically runs in its own container.
//
// Default targets the documented dev workflow (deno on host + cloakbrowser via docker):
// `host.docker.internal` resolves to the host from inside chrome's container on Docker
// Desktop / Colima / OrbStack (Mac) and on Linux when started with
// `--add-host=host.docker.internal:host-gateway`.
//
// Override scenarios:
//   - docker-compose: set to the deno service's network hostname (e.g. http://trmnl-byos-dev:3000)
//   - chrome runs natively on host: set to http://127.0.0.1:${PORT}
//   - linux without host-gateway: set to the host's LAN IP
export const INTERNAL_URL_ORIGIN = env(
  "INTERNAL_URL_ORIGIN",
  `http://host.docker.internal:${PORT}`,
);

// Absolute path to the user's template directory. The directory must contain a `main.ts`
// that exports a `run` function. Defaults to the bundled example template; bind-mount
// over this path (or override the env var) to ship your own.
export const TEMPLATE_DIR = resolve(env("TEMPLATE_DIR", "./templates/example"));

// Optional absolute path to a "seed" template (the bundled example, baked into the
// Docker image at /app/template-seed). When set and TEMPLATE_DIR is empty, the service
// copies the seed in before loading. Empty/unset = no seeding (the dev workflow, where
// TEMPLATE_DIR already points at the populated example checked into the repo).
const seedRaw = env("TEMPLATE_SEED_DIR", "");
export const TEMPLATE_SEED_DIR = seedRaw ? resolve(seedRaw) : "";

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
