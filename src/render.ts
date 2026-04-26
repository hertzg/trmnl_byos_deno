import { launch } from "@astral/astral";
import { join } from "@std/path";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./config.ts";

const TEMPLATE_PATH = join(import.meta.dirname ?? ".", "..", "templates", "default.html");

let templateCache: string | null = null;

async function loadTemplate(): Promise<string> {
  if (templateCache) return templateCache;
  templateCache = await Deno.readTextFile(TEMPLATE_PATH);
  return templateCache;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

let browserPromise: Promise<Awaited<ReturnType<typeof launch>>> | null = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });
  }
  return browserPromise;
}

export async function renderScreenPng(): Promise<Uint8Array> {
  const template = await loadTemplate();
  const now = new Date();
  const html = interpolate(template, {
    TITLE: "Hello from Deno BYOS",
    SUBTITLE: "Plain HTML + TRMNL framework",
    TIME: now.toISOString(),
    HOSTNAME: Deno.hostname(),
  });

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    await page.setContent(html, { waitUntil: "networkidle2" });
    const buf = await page.screenshot({ format: "png" });
    return buf;
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
