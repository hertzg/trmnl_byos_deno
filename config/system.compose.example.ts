import { resolve } from "@std/path";
import type { SystemConfig } from "./system.example.ts";

// Compose-mode system config (ADR-0010). docker-compose.yml bind-mounts this
// committed starter directly onto the container's config/system.ts, so the
// compose dev environment gets its own loopbackHost without an env override and
// without touching the system.ts used by `deno task dev` / the Pi.
//
// The only difference from system.example.ts is loopbackHost: in compose, chrome
// shares the deno container's network namespace, so the Renderer's ephemeral
// loopback origin must bind 127.0.0.1 (reachable by chrome via the shared netns),
// not the host.docker.internal default that `deno task dev` (deno on the host)
// wants.
export const system = {
  port: 3000,
  // Empty → use request Host/X-Forwarded-*. Set only behind a reverse proxy.
  publicUrlOrigin: "",
  friendlyId: "TRMNL",

  cdpUrl: "http://localhost:9222",

  // Compose-mode pin: chrome shares this container's netns, so 127.0.0.1 reaches
  // the Renderer's loopback origin (and keeps the ephemeral port bound to the
  // loopback interface only).
  loopbackHost: "127.0.0.1",

  // resolve(...) so it's an absolute path regardless of cwd.
  pluginDir: resolve("./templates/example"),

  deviceId: "trmnl-x",
} satisfies SystemConfig;
