import { resolve } from "@std/path";
import type { Plugin } from "@hztrmnl/server/plugin";
import plugin from "@hztrmnl/home";

// SystemConfig mirrors system.example.ts. Kept inline so this file resolves
// correctly both in its committed location (config/) and when bind-mounted as
// config/live/system.ts (where a relative ../system.example.ts would be needed
// but config/ example files are image-owned, not in the live mount).
type SystemConfig = {
  port: number;
  publicUrlOrigin: string;
  friendlyId: string;
  cdpUrl: string;
  loopbackHost: string;
  plugin: Plugin<unknown>;
  pluginAssetsDir: string;
  deviceId: string;
  // Luma+dither implementation. Optional — an older live system.ts without
  // this field keeps working and means "wasm".
  ditherEngine?: "wasm" | "native";
  // Debug mode: the server boots the debug panel instead of the normal
  // pipeline (no Plugin, no CDP). Optional — absent means false.
  debug?: boolean;
};

// Compose-mode system config (ADR-0010). docker-compose.yml bind-mounts this
// committed starter directly onto the container's config/live/system.ts, so the
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

  plugin,
  // Interim until the byte-handling redesign: where the deployed Plugin's assets/ live.
  pluginAssetsDir: resolve("./plugins/home/assets"),

  deviceId: "trmnl-x",

  // "wasm" (fused SIMD kernel, default) or "native" (plain-TypeScript
  // reference pipeline). Visually equivalent; the switch is for A/B'ing.
  ditherEngine: "wasm",

  // true → boot the debug panel instead of the normal pipeline. See the
  // SystemConfig comment above.
  debug: false,
} satisfies SystemConfig;
