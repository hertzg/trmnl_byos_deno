import { launch } from "@astral/astral";
import { join } from "@std/path";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./config.ts";

const TEMPLATE_PATH = join(import.meta.dirname ?? ".", "..", "templates", "default.html");

let templateCache: string | null = null;

async function loadTemplate(fresh = false): Promise<string> {
  if (!fresh && templateCache) return templateCache;
  templateCache = await Deno.readTextFile(TEMPLATE_PATH);
  return templateCache;
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

export async function renderScreenHtml(fresh = false): Promise<string> {
  const tpl = await loadTemplate(fresh);
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
      ],
    });
  }
  return browserPromise;
}

export async function renderScreenPng(opts: { fresh?: boolean } = {}): Promise<Uint8Array> {
  const html = await renderScreenHtml(opts.fresh);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    await page.setContent(html, { waitUntil: "networkidle2" });
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
