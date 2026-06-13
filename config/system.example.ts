import { resolve } from "@std/path";

// Server infra config. This is the committed starter; copy it to `config/system.ts`
// (gitignored) and edit that. Per-environment differences (dev 127.0.0.1 vs. compose
// vs. Pi) live in each environment's own mounted `system.ts`, not in code branches.
// No env parsing — every value is a literal here.
export type SystemConfig = {
  port: number;
  publicUrlOrigin: string;
  friendlyId: string;
  cdpUrl: string;
  loopbackHost: string;
  pluginDir: string;
  deviceId: string;
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

  // resolve(...) so it's an absolute path regardless of cwd.
  pluginDir: resolve("./templates/example"),

  deviceId: "trmnl-x",
} satisfies SystemConfig;
