import { Hono } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import type { DeviceState } from "../device-state.ts";
import type { DeviceProfile } from "../render/profiles.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";
import { isPattern, renderPattern } from "./patterns.ts";
import { type BuildInfo, readBuildInfo } from "../build-info.ts";
import DebugPage from "./debug.tsx";

// Debug-mode facade. When system.debug is true this app replaces the
// Conductor AND the dashboard: /api/display returns exactly the operator's
// configured response, /image serves generated test patterns, and / is the
// control panel. The Plugin/renderer/Slot pipeline never starts, so debug
// mode also works when Chrome/CDP is down — handy when the point is to poke
// the panel, not the pipeline.

export type DebugDisplayConfig = {
  imageSource: "pattern" | "custom";
  pattern: string;
  refreshRate: number;
  status: number;
  temperatureProfile: string;
  specialFunction: string;
  resetFirmware: boolean;
  updateFirmware: boolean;
  firmwareUrl: string;
  responseOverride: Record<string, unknown> | null;
  proxyEnabled: boolean;
  proxyTarget: string;
};

export type DebugCustomImageInfo = {
  filename: string;
  mediaType: string;
  byteLength: number;
  uploadedAt: Temporal.ZonedDateTime;
  version: number;
};

type DebugCustomImage = DebugCustomImageInfo & {
  bytes: Uint8Array<ArrayBuffer>;
};

// Matches the Conductor's normal response where a field has a fixed value
// (status 0, temperature_profile "a") so entering debug mode changes nothing
// until the operator edits a field. 60 s refresh keeps iteration tight.
const DEFAULTS: DebugDisplayConfig = {
  imageSource: "pattern",
  pattern: "wedge",
  refreshRate: 60,
  status: 0,
  temperatureProfile: "a",
  specialFunction: "none",
  resetFirmware: false,
  updateFirmware: false,
  firmwareUrl: "",
  responseOverride: null,
  proxyEnabled: false,
  proxyTarget: "",
};

export type DebugDeps = {
  profile: DeviceProfile;
  deviceState: DeviceState;
  friendlyId: string;
  now: () => Temporal.ZonedDateTime;
  fetch?: typeof fetch;
  // Build identity shown in the topbar, same as the dashboard's. Defaults
  // to reading the baked build-info.json ("<version>+dev" outside Docker).
  build?: BuildInfo;
};

export function createDebugApp(deps: DebugDeps): Hono {
  let cfg: DebugDisplayConfig = { ...DEFAULTS };
  let customImage: DebugCustomImage | null = null;
  let customImageVersion = 0;
  let responseJsonError: string | null = null;
  let proxyError: string | null = null;
  const fetchImpl = deps.fetch ?? fetch;

  // Patterns are deterministic per (name, profile), and the profile is fixed
  // for the process — render each once, lazily.
  const patternCache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  function patternPng(name: string): Promise<Uint8Array<ArrayBuffer>> {
    let png = patternCache.get(name);
    if (!png) {
      png = renderPattern(name, deps.profile);
      patternCache.set(name, png);
    }
    return png;
  }

  function customImageId(image: DebugCustomImage): string {
    return `debug-custom-${image.version}`;
  }

  function customImageInfo(): DebugCustomImageInfo | null {
    if (!customImage) return null;
    const { bytes: _bytes, ...info } = customImage;
    return info;
  }

  function imageRef(origin: string): { imageUrl: string; filename: string } {
    if (cfg.imageSource === "custom" && customImage) {
      const filename = customImageId(customImage);
      return { imageUrl: `${origin}/image/${filename}.png`, filename };
    }
    const filename = `debug-${cfg.pattern}`;
    return { imageUrl: `${origin}/image/${filename}.png`, filename };
  }

  function generatedDisplayResponse(origin: string): Record<string, unknown> {
    const image = imageRef(origin);
    return {
      status: cfg.status,
      image_url: image.imageUrl,
      // The pattern name keys the filename, so switching patterns always
      // reads as a new image to the firmware.
      filename: image.filename,
      refresh_rate: cfg.refreshRate,
      reset_firmware: cfg.resetFirmware,
      update_firmware: cfg.updateFirmware,
      firmware_url: cfg.firmwareUrl,
      special_function: cfg.specialFunction,
      temperature_profile: cfg.temperatureProfile,
    };
  }

  function displayResponse(origin: string): Record<string, unknown> {
    return cfg.responseOverride ?? generatedDisplayResponse(origin);
  }

  return new Hono()
    .get("/", async (c) => {
      const device = deps.deviceState.latestDevice();
      const page = renderToString(
        DebugPage({
          now: deps.now(),
          build: deps.build ?? await readBuildInfo(),
          cfg,
          response: displayResponse(publicOrigin(c)),
          generatedResponse: generatedDisplayResponse(publicOrigin(c)),
          responseJsonError,
          proxyError,
          customImage: customImageInfo(),
          device,
          latestFirmware: await latestOfficialFirmware(device?.model ?? null, fetchImpl),
          rawHeaders: deps.deviceState.latestPollHeaders(),
          logs: deps.deviceState.recentLogs(),
        }),
      );
      return c.html("<!DOCTYPE html>" + page, 200, { "cache-control": "no-store" });
    })
    .post("/debug/config", async (c) => {
      const body = await c.req.parseBody();
      const str = (k: string): string | undefined =>
        typeof body[k] === "string" ? body[k] as string : undefined;
      const int = (k: string): number | undefined => {
        const raw = str(k);
        if (raw === undefined || raw.trim() === "") return undefined;
        const n = Number(raw);
        return Number.isSafeInteger(n) ? n : undefined;
      };
      const uploaded = body["customImage"];
      const pattern = str("pattern");
      let imageSource = cfg.imageSource;
      let nextPattern = cfg.pattern;
      if (uploaded instanceof File && uploaded.size > 0) {
        customImage = {
          filename: uploaded.name || "custom",
          mediaType: uploaded.type || "application/octet-stream",
          byteLength: uploaded.size,
          uploadedAt: deps.now(),
          version: ++customImageVersion,
          bytes: new Uint8Array(await uploaded.arrayBuffer()),
        };
        imageSource = "custom";
      } else if (pattern === "custom" && customImage) {
        imageSource = "custom";
      } else if (pattern !== undefined && isPattern(pattern)) {
        imageSource = "pattern";
        nextPattern = pattern;
      }
      cfg = {
        imageSource,
        pattern: nextPattern,
        refreshRate: Math.max(1, int("refreshRate") ?? cfg.refreshRate),
        status: int("status") ?? cfg.status,
        temperatureProfile: str("temperatureProfile") ?? cfg.temperatureProfile,
        specialFunction: str("specialFunction") ?? cfg.specialFunction,
        // Unchecked checkboxes are simply absent from the form body, so
        // presence *is* the value — no fallback to the previous state.
        resetFirmware: body["resetFirmware"] !== undefined,
        updateFirmware: body["updateFirmware"] !== undefined,
        firmwareUrl: str("firmwareUrl") ?? cfg.firmwareUrl,
        responseOverride: null,
        proxyEnabled: cfg.proxyEnabled,
        proxyTarget: cfg.proxyTarget,
      };
      responseJsonError = null;
      // 303 turns the browser's next request into a GET.
      return c.redirect("/", 303);
    })
    .post("/debug/response", async (c) => {
      const body = await c.req.parseBody();
      const raw = typeof body["responseJson"] === "string" ? body["responseJson"] : "";
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) throw new Error("response JSON must be an object");
        cfg = { ...cfg, responseOverride: parsed };
        responseJsonError = null;
      } catch (err) {
        responseJsonError = err instanceof Error ? err.message : String(err);
      }
      return c.redirect("/", 303);
    })
    .post("/debug/response/reset", (c) => {
      cfg = { ...cfg, responseOverride: null };
      responseJsonError = null;
      return c.redirect("/", 303);
    })
    .post("/debug/proxy", async (c) => {
      const body = await c.req.parseBody();
      const target = typeof body["proxyTarget"] === "string" ? body["proxyTarget"].trim() : "";
      const enabled = body["proxyEnabled"] !== undefined;
      if (!enabled) {
        cfg = { ...cfg, proxyEnabled: false, proxyTarget: target };
        proxyError = null;
        return c.redirect("/", 303);
      }
      try {
        cfg = { ...cfg, proxyEnabled: true, proxyTarget: normalizeProxyTarget(target) };
        proxyError = null;
      } catch (err) {
        cfg = { ...cfg, proxyEnabled: false, proxyTarget: target };
        proxyError = err instanceof Error ? err.message : String(err);
      }
      return c.redirect("/", 303);
    })
    .use("*", async (c, next) => {
      const pathname = new URL(c.req.url).pathname;
      if (cfg.proxyEnabled && !isDebugControlPath(pathname)) {
        recordDeviceSideEffects(c.req.raw, deps);
        if (pathname === "/api/log") {
          const body = await c.req.raw.clone().text();
          const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
          deps.deviceState.appendLog(id, body);
        }
        return await proxyRequest(c.req.raw, cfg.proxyTarget, fetchImpl);
      }
      await next();
    })
    .get("/api/setup", (c) =>
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/image/setup.png`,
        message: "Welcome (debug mode)",
      }))
    .get("/api/display", (c) => {
      recordDeviceSideEffects(c.req.raw, deps);
      return c.json(displayResponse(publicOrigin(c)));
    })
    .get("/image/:id{.+\\.png}", async (c) => {
      const id = c.req.param("id").replace(/\.png$/, "");
      if (customImage && id === customImageId(customImage)) {
        return c.body(customImage.bytes, 200, {
          "content-type": customImage.mediaType,
          "cache-control": "no-store",
        });
      }
      const name = id.replace(/^debug-/, "");
      if (name === id || !isPattern(name)) return c.notFound();
      return c.body(await patternPng(name), 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.deviceState.appendLog(id, body);
      return c.body(null, 204);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Latest official firmware for the Device's model family, so the panel can
// offer a "paste into firmware_url" button. Official binaries live in
// TRMNL's public S3 bucket (usetrmnl.com/api/firmware/latest only answers
// for the OG model); release keys are `<family>/FW<dotted-version>.bin`
// exactly, which also skips the `<family>/dev/…` CI builds. Panel-render
// convenience only: fetched per page load, never throws — no release, no
// button. The short timeout keeps the panel usable offline.
const FIRMWARE_BUCKET = "https://trmnl-fw.s3.us-east-2.amazonaws.com";
const FIRMWARE_FAMILY_BY_MODEL: Record<string, string> = {
  x: "trmnl_x",
  og: "trmnl_og",
};

export type LatestFirmware = {
  version: string;
  url: string;
};

async function latestOfficialFirmware(
  model: string | null,
  fetchImpl: typeof fetch,
): Promise<LatestFirmware | null> {
  const family = FIRMWARE_FAMILY_BY_MODEL[model ?? ""];
  if (!family) return null;
  try {
    const res = await fetchImpl(`${FIRMWARE_BUCKET}/?list-type=2&prefix=${family}/`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const xml = await res.text();
    const keys = new RegExp(`<Key>${family}/FW(\\d+(?:\\.\\d+)*)\\.bin</Key>`, "g");
    // Numeric compare — lexicographic order would put 1.8.9 above 1.8.10.
    const byVersion = (a: string, b: string) => {
      const as = a.split(".").map(Number);
      const bs = b.split(".").map(Number);
      for (let i = 0; i < Math.max(as.length, bs.length); i++) {
        if ((as[i] ?? 0) !== (bs[i] ?? 0)) return (as[i] ?? 0) - (bs[i] ?? 0);
      }
      return 0;
    };
    const top = [...xml.matchAll(keys)].map((m) => m[1]).sort(byVersion).at(-1);
    return top === undefined
      ? null
      : { version: top, url: `${FIRMWARE_BUCKET}/${family}/FW${top}.bin` };
  } catch {
    return null;
  }
}

function recordDeviceSideEffects(req: Request, deps: DebugDeps): void {
  const pathname = new URL(req.url).pathname;
  if (pathname !== "/api/display") return;
  const report = parseDeviceHeaders(req.headers, deps.now);
  if (report) deps.deviceState.reportDevice(report, [...req.headers.entries()]);
}

function isDebugControlPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/debug" || pathname.startsWith("/debug/");
}

function normalizeProxyTarget(raw: string): string {
  if (raw === "") throw new Error("proxy target URL is required");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("proxy target must start with http:// or https://");
  }
  url.hash = "";
  return url.toString();
}

function proxyTargetUrl(targetRaw: string, requestRaw: string): URL {
  const target = new URL(targetRaw);
  const incoming = new URL(requestRaw);
  const basePath = target.pathname.replace(/\/$/, "");
  target.pathname = `${basePath}${incoming.pathname}`;
  target.search = incoming.search;
  target.hash = "";
  return target;
}

async function proxyRequest(
  req: Request,
  targetRaw: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const target = proxyTargetUrl(targetRaw, req.url);
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");

  const method = req.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") init.body = await req.arrayBuffer();

  try {
    const upstream = await fetchImpl(target, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("transfer-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`debug proxy failed: ${message}`, {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
