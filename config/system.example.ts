import { resolve } from "@std/path";
import type { Plugin } from "@hztrmnl/server/plugin";
import plugin from "@hztrmnl/home";

// Server infra config. This is the committed starter; copy it to `config/live/system.ts`
// (gitignored) and edit that. Per-environment differences (dev 127.0.0.1 vs. compose
// vs. Pi) live in each environment's own mounted `system.ts`, not in code branches.
// No env parsing — every value is a literal here.
export type SystemConfig = {
  port: number;
  publicUrlOrigin: string;
  friendlyId: string;
  cdpUrl: string;
  loopbackHost: string;
  plugin: Plugin<unknown>;
  pluginAssetsDir: string;
  deviceId: string;
  // IANA time zone (e.g. "Europe/Berlin"). The Device's wall clock;
  // carried into every RunContext.t so Plugins compare clock fields directly.
  timeZone: string;
  // Luma+dither implementation. Optional — an older live system.ts without
  // this field keeps working and means "wasm".
  ditherEngine?: "wasm" | "native";
  // Debug mode: the server boots the debug panel instead of the normal
  // pipeline (no Plugin, no CDP). The panel at / gives exact control over the
  // /api/display response, serves built-in test patterns, and shows what the
  // Device sends. Toggle it from webproc by editing this file and restarting.
  // Optional — absent means false.
  debug?: boolean;
};

export const system = {
  port: 3000,
  // Empty → use request Host/X-Forwarded-*. Set only behind a reverse proxy.
  publicUrlOrigin: "",
  friendlyId: "TRMNL",

  cdpUrl: "http://localhost:9222",

  // Hostname the Renderer hands CDP. Default targets `deno task dev` (chrome
  // in docker reaches host via host.docker.internal). Compose mode pins
  // "127.0.0.1". See bind-host trade-off in renderer.ts.
  loopbackHost: "host.docker.internal",

  plugin,
  // Interim until the byte-handling redesign: where the deployed Plugin's assets/ live.
  pluginAssetsDir: resolve("./plugins/home/assets"),

  deviceId: "trmnl-x",

  timeZone: "Europe/Berlin",

  // "wasm" (fused SIMD kernel, default) or "native" (plain-TypeScript
  // reference pipeline). Visually equivalent; the switch is for A/B'ing.
  ditherEngine: "wasm",

  // true → boot the debug panel instead of the normal pipeline. See the
  // SystemConfig comment above.
  debug: false,
} satisfies SystemConfig;
