import { launch } from "@astral/astral";
import { join } from "@std/path";
import { PIXEL_RATIO, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "./config.ts";

const TEMPLATE_PATH = join(import.meta.dirname ?? ".", "..", "templates", "default.html");

// Always re-read on every render — file is tiny and this gives instant
// edit-refresh feedback in dev without any cache-bust query param.
async function loadTemplate(): Promise<string> {
  return await Deno.readTextFile(TEMPLATE_PATH);
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

function buildVars(): Record<string, string> {
  const now = new Date();
  return {
    TITLE: "Hello from Deno BYOS",
    SUBTITLE: "Plain HTML + TRMNL framework",
    TIME: now.toISOString(),
    HOSTNAME: Deno.hostname(),
  };
}

export async function renderScreenHtml(): Promise<string> {
  const tpl = await loadTemplate();
  return interpolate(tpl, buildVars());
}

let browserPromise: Promise<Awaited<ReturnType<typeof launch>>> | null = null;

function getBrowser() {
  if (!browserPromise) {
    const path = Deno.env.get("ASTRAL_BIN") ?? Deno.env.get("CHROMIUM_PATH");
    browserPromise = launch({
      headless: true,
      ...(path ? { path } : {}),
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
        `--force-device-scale-factor=${PIXEL_RATIO}`,
      ],
    });
  }
  return browserPromise;
}

export async function renderScreenPng(): Promise<Uint8Array> {
  const html = await renderScreenHtml();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    await page.setContent(html);
    // Wait for framework CSS, fonts, and any sub-resources to finish loading.
    // Astral's setContent does not honor puppeteer's waitUntil reliably.
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
    await new Promise((r) => setTimeout(r, 800));
    return await page.screenshot({ format: "png" });
  } finally {
    await page.close();
  }
}

export async function shutdownBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
