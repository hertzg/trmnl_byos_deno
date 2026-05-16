import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import type { Conductor } from "../conductor/conductor.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "./request.ts";

export type ConductorAppDeps = {
  conductor: Conductor;
  friendlyId: string;
  pluginAssetsDir: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

export function createConductorApp(deps: ConductorAppDeps): Hono {
  const app = new Hono();

  app.get("/api/setup", (c) => {
    return c.json({
      status: 200,
      api_key: "byos",
      friendly_id: deps.friendlyId,
      image_url: `${publicOrigin(c)}/images/setup/png`,
      message: "Welcome",
    });
  });

  app.get("/api/display", async (c) => {
    const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
    if (report) deps.conductor.reportDevice(report);
    const now = deps.now();
    const out = await deps.conductor.trigger({ t: now, intent: "poll" });
    const secondsUntilExpiry = Math.max(
      1,
      Math.ceil(out.expiresAt.since(now, { largestUnit: "seconds" }).total({ unit: "seconds" })),
    );
    return c.json({
      status: 0,
      image_url: `${publicOrigin(c)}/images/${out.identity}/png`,
      filename: `image-${out.identity}`,
      refresh_rate: secondsUntilExpiry,
      reset_firmware: false,
      update_firmware: false,
      firmware_url: "",
      special_function: "none",
      maximum_compatibility: true,
    });
  });

  app.post("/api/log", async (c) => {
    const body = await c.req.text();
    const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
    deps.onDeviceLog?.(id, body);
    return c.body(null, 204);
  });

  app.get("/images/:identity/png", (c) => {
    const png = deps.conductor.getCurrentImage(c.req.param("identity"));
    if (png === undefined) return c.body(null, 404);
    return c.body(png as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
  });

  app.use("/assets/*", serveStatic({ root: deps.pluginAssetsDir }));

  return app;
}
