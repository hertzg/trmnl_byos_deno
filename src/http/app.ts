import { Hono } from "hono";
import type { Renderer } from "../render/renderer.ts";
import { publicOrigin } from "./request.ts";

export type AppDeps = {
  renderer: Renderer;
  friendlyId: string;
  onDeviceLog?: (id: string, body: string) => void;
};

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/setup", (c) => {
    return c.json({
      status: 200,
      api_key: "byos",
      friendly_id: deps.friendlyId,
      // No frame to point at yet — the device proceeds to /api/display next, which
      // resolves to a real jobId. This URL 404s if the device fetches it; firmware
      // recovers via the next /api/display poll.
      image_url: `${publicOrigin(c)}/preview/setup/png`,
      message: "Welcome",
    });
  });

  app.get("/api/display", async (c) => {
    const frame = await deps.renderer.ensureFrame();
    const refreshRate = Math.max(
      1,
      Math.ceil((frame.validUntil.getTime() - Date.now()) / 1000),
    );
    return c.json({
      status: 0,
      image_url: `${publicOrigin(c)}/preview/${frame.jobId}/png`,
      filename: `image-${frame.jobId}`,
      refresh_rate: refreshRate,
      reset_firmware: false,
      update_firmware: false,
      firmware_url: "",
      special_function: "none",
      // Forces REFRESH_FULL every cycle on TRMNL X — avoids ghosting between dither variants.
      maximum_compatibility: true,
    });
  });

  app.post("/api/log", async (c) => {
    const body = await c.req.text();
    const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
    deps.onDeviceLog?.(id, body);
    return c.body(null, 204);
  });

  app.get("/preview", async (c) => {
    try {
      const html = await deps.renderer.previewHtml();
      return c.html(html, 200, { "cache-control": "no-store" });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const escape = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const body =
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>preview error</title></head>` +
        `<body><h1>preview error</h1><pre>${escape(e.message)}\n\n${escape(e.stack ?? "")}</pre>` +
        `</body></html>`;
      return c.html(body, 500, { "cache-control": "no-store" });
    }
  });

  app.get("/preview/png", async (c) => {
    const png = await deps.renderer.previewPng();
    return c.body(png as unknown as ArrayBuffer, 200, {
      "content-type": "image/png",
      "cache-control": "no-store",
    });
  });

  app.get("/preview/:jobId/png", (c) => {
    const png = deps.renderer.getJobPng(c.req.param("jobId"));
    if (png === undefined) return c.body(null, 404);
    return c.body(png as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
  });

  app.get("/preview/:jobId", (c) => {
    const html = deps.renderer.getJobHtml(c.req.param("jobId"));
    if (html === undefined) return c.body(null, 404);
    return c.html(html, 200, { "cache-control": "no-store" });
  });

  return app;
}
