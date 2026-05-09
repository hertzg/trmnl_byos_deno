import { join } from "@std/path";
import {
  ACTIVE_PROFILE,
  CDP_URL,
  FRIENDLY_ID,
  INTERNAL_URL_ORIGIN,
  PORT,
  TEMPLATE_DIR,
  TEMPLATE_SEED_DIR,
} from "./config.ts";
import { createRenderer } from "./render/renderer.ts";
import { createRasterize } from "./render/rasterize.ts";
import { loadTemplate, seedTemplateDir } from "./template/loader.ts";
import ErrorCard from "./template/error-card.tsx";
import { createApp } from "./http/app.ts";
import { Hono } from "hono";
import { serveStatic } from "hono/deno";

async function main() {
  if (TEMPLATE_SEED_DIR) {
    await seedTemplateDir(TEMPLATE_DIR, TEMPLATE_SEED_DIR);
  }

  const template = await loadTemplate(TEMPLATE_DIR);
  console.log(`[template] loaded from ${TEMPLATE_DIR}`);

  const panel = { width: ACTIVE_PROFILE.width, height: ACTIVE_PROFILE.height };
  const { onDisplay } = await template.setup({ panel });

  const rasterize = createRasterize({
    cdpUrl: CDP_URL,
    ...ACTIVE_PROFILE,
  });

  const renderer = createRenderer({
    onDisplay,
    rasterize,
    origin: INTERNAL_URL_ORIGIN,
    errorJsx: (err) => ErrorCard({ message: err.message }),
    errorValiditySeconds: 30,
  });

  const app = new Hono();

  app.use(async (c, next) => {
    const t0 = Date.now();
    await next();
    console.log(
      `${c.req.method} ${new URL(c.req.url).pathname} → ${c.res.status} ${Date.now() - t0}ms`,
    );
  });

  app.onError((err, c) => {
    console.error("[handler]", err);
    return c.json({ error: "internal" }, 500);
  });

  // BYOS + addressed-preview routes from the testable factory.
  app.route(
    "/",
    createApp({
      renderer,
      friendlyId: FRIENDLY_ID,
      onDeviceLog: (id, body) => console.log(`[device-log] ${id.toUpperCase()}: ${body}`),
    }),
  );

  // Probe for an assets/ subdirectory once at boot. If it exists, /assets/* serves files
  // from it; otherwise the route 404s.
  const assetsDir = join(TEMPLATE_DIR, "assets");
  let assetsAvailable = false;
  try {
    const stat = await Deno.stat(assetsDir);
    assetsAvailable = stat.isDirectory;
  } catch {
    assetsAvailable = false;
  }
  if (assetsAvailable) {
    console.log(`[assets] serving /assets/* from ${assetsDir}`);
    app.get("/assets/*", serveStatic({ root: TEMPLATE_DIR }));
  }

  console.log(`trmnl-byos-deno on :${PORT}`);
  await Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch).finished;
}

await main();
