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
  // true → every /api/display poll checks TRMNL's official firmware bucket
  // for the Device's reported model and, if a newer release exists, sets
  // update_firmware/firmware_url so the Device installs it on its own.
  // Optional — absent means false (no auto-update; firmware_url stays empty).
  firmwareAutoUpdate?: boolean;
};

export const system = {
  port: 3000,
  // Empty → use request Host/X-Forwarded-*. Set only behind a reverse proxy.
  publicUrlOrigin: "",
  friendlyId: "TRMNL",

  cdpUrl: "http://localhost:9222",

  // Hostname the Renderer hands CDP. "127.0.0.1" covers both run modes:
  // compose (chrome shares the deno container's netns) and `deno task dev`
  // with a host-networked chrome container. A port-mapped dev chrome instead
  // needs "host.docker.internal" — set it in your live copy, not here. See
  // bind-host trade-off in renderer.ts.
  loopbackHost: "127.0.0.1",

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
