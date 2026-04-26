import { launch } from "@astral/astral";
import { PIXEL_RATIO, VIEWPORT_H, VIEWPORT_W } from "./config.ts";

const TEMPLATE_PATH = new URL("../templates/default.html", import.meta.url);

export async function renderTemplateToPng(): Promise<Uint8Array> {
  const html = await readAndInterpolateTemplate();

  const browser = await launch({
    headless: true,
    path: Deno.env.get("ASTRAL_BIN"),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${PIXEL_RATIO}`,
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: VIEWPORT_W, height: VIEWPORT_H });
    await page.setContent(html);
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
    // Give CDN-loaded CSS/fonts a moment to settle before snapshotting.
    await new Promise((r) => setTimeout(r, 800));
    return await page.screenshot({ format: "png" });
  } finally {
    await browser.close();
  }
}

async function readAndInterpolateTemplate(): Promise<string> {
  const template = await Deno.readTextFile(TEMPLATE_PATH);
  const vars: Record<string, string> = {
    TIME: new Date().toISOString(),
    HOSTNAME: Deno.hostname(),
  };
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
