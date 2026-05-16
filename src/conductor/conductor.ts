import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import type { DeviceReport, Plugin, Result, RunContext } from "../plugin/plugin.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";

// The Conductor is opaque to the Plugin's state shape — `any` here is
// the orchestrator's "I don't know S, and I shouldn't have to" boundary.
// Plugin authors keep full type safety inside their own `run` and `view`.
export type RendererDep = {
  // deno-lint-ignore no-explicit-any
  deriveHtml(result: Result<any>): string | Promise<string>;
  rasterize(html: string, hints?: Record<string, unknown>): Promise<Uint8Array>;
};

export type ConductorDeps = {
  // deno-lint-ignore no-explicit-any
  plugin: Plugin<any>;
  renderer: RendererDep;
  identityFor: (html: string) => string | Promise<string>;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  // BYOS surface — these flow through the Conductor's own Hono sub-app.
  friendlyId: string;
  pluginAssetsDir: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

// `createConductor` returns a Hono directly. The orchestration logic
// (trigger / reportDevice / getCurrentImage) lives entirely inside the
// factory closure — its only external surface is HTTP. Nothing outside
// this module needs to invoke the orchestration programmatically; the
// routes are the seam.
export function createConductor(deps: ConductorDeps): Hono {
  // deno-lint-ignore no-explicit-any
  type CurrentResult = { ctx: RunContext; result: Result<any> };
  type CurrentImage = { png: Uint8Array; identity: string };

  let currentResult: CurrentResult | null = null;
  let currentImage: CurrentImage | null = null;
  let latestDevice: DeviceReport | null = null;

  async function trigger(input: {
    t: Temporal.ZonedDateTime;
    intent: "poll" | "scrub" | "prerender";
  }): Promise<{ png: Uint8Array; identity: string; expiresAt: Temporal.ZonedDateTime }> {
    if (currentResult && currentImage) {
      const currentExpiry = currentResult.ctx.t.add(currentResult.result.validity);
      if (Temporal.ZonedDateTime.compare(input.t, currentExpiry) < 0) {
        return {
          png: currentImage.png,
          identity: currentImage.identity,
          expiresAt: currentExpiry,
        };
      }
    }
    const ctx: RunContext = {
      t: input.t,
      intent: input.intent,
      device: latestDevice,
    };
    // deno-lint-ignore no-explicit-any
    let result: Result<any>;
    try {
      result = await deps.plugin.run(ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      result = {
        state: error,
        validity: deps.errorValidity,
        view: deps.errorView,
      };
    }
    const html = await deps.renderer.deriveHtml(result);
    const identity = await deps.identityFor(html);
    currentResult = { ctx, result };
    if (currentImage?.identity !== identity) {
      const png = await deps.renderer.rasterize(html, result.hints);
      currentImage = { png, identity };
    }
    return {
      png: currentImage.png,
      identity: currentImage.identity,
      expiresAt: input.t.add(result.validity),
    };
  }

  return new Hono()
    .get("/api/setup", (c) =>
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/images/setup/png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) latestDevice = report;
      const now = deps.now();
      const out = await trigger({ t: now, intent: "poll" });
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
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.onDeviceLog?.(id, body);
      return c.body(null, 204);
    })
    .get("/images/:identity/png", (c) => {
      const id = c.req.param("identity");
      const png = currentImage?.identity === id ? currentImage.png : undefined;
      if (png === undefined) return c.body(null, 404);
      return c.body(png as unknown as ArrayBuffer, 200, { "content-type": "image/png" });
    })
    .use("/assets/*", serveStatic({ root: deps.pluginAssetsDir }));
}
