import { Hono } from "hono";
import type { DeviceReport, RunContext } from "../plugin/plugin.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Slot, SlotDisplay } from "../slot/slot.ts";
import { parseDeviceHeaders } from "../device.ts";
import { publicOrigin } from "../http/request.ts";

// The Conductor is the BYOS-facing facade. It owns the orchestration loop
// from Device poll (`/api/display`) through Plugin run → Renderer.identity
// → eager Renderer.rasterize → Slot.put, and serves the resulting PNG bytes
// at `/image/<identity>.png`. The Plugin's state shape is opaque to the
// Conductor — `pluginManager.run(ctx)` returns a Bundle whose details the
// Conductor doesn't inspect.
//
// Three tiers of laziness govern each /api/display poll (ADR-0004):
//
//   Tier 1 — Slot still valid: return cached identity; no Plugin run.
//   Tier 2 — Slot expired, identity unchanged: (reserved, not implemented).
//   Tier 3 — Slot expired or empty: run Plugin, compute identity, start
//            rasterize, put into Slot, return new identity.
//
// On any throw inside steps 2–3, the loop re-enters with an error Bundle
// built from `errorView` + `errorValidity` (~30 s). The error Bundle flows
// through the Slot exactly like a real Bundle — no second cache path.
//
// Concurrent /api/display calls share a single in-flight refill (single-
// flight) so a cache miss runs the Plugin at most once.

export type ConductorDeps = {
  // Loaded once at boot; reused across calls. Captures the Plugin module +
  // its on-disk assets folder. See src/plugin/plugin-manager.ts.
  pluginManager: PluginManager;
  // The Renderer owns Bundle → identity and Bundle → Image. The Conductor
  // calls `identity(bundle)` to derive the Slot's cache key + Device's
  // filename, and starts `rasterize(bundle)` (not awaited) so the eager
  // PNG promise is in flight by the time the Device follows up with
  // `/image/<identity>.png`.
  renderer: Renderer;
  // Single-Image cache (ADR-0004). The Conductor pushes
  // `{ bundle, identity, image, cachedAt }` triples in via `slot.put`; the
  // Slot answers `display()` / `image(id)` for the orchestration loop and
  // the /image/<id>.png handler respectively.
  slot: Slot;
  // Server-supplied error view + validity. When Plugin.run or
  // Renderer.identity throws, the Conductor wraps the Error in a Result
  // using these and re-enters the orchestration loop.
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
  // BYOS surface — these flow through the Conductor's own Hono sub-app.
  friendlyId: string;
  onDeviceLog?: (id: string, body: string) => void;
  now: () => Temporal.ZonedDateTime;
};

export type Conductor = {
  // Hono sub-app for the BYOS surface (`/api/setup`, `/api/display`,
  // `/api/log`) plus the identity-keyed render output (`/image/:id.png`).
  // No public `/assets/*` route — Plugin assets travel inside Bundles to
  // Renderer's internal loopback origin only (ADR-0003 / ADR-0005).
  app: Hono;
};

// The orchestration logic lives entirely inside the factory closure;
// peers reach it through the Conductor's HTTP surface.
export function createConductor(deps: ConductorDeps): Conductor {
  let latestDevice: DeviceReport | null = null;

  // Wrap an Error in the Server-supplied error view as a Result. Used by
  // the orchestration loop's catch arm.
  function errorResult(err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      state: error,
      validity: deps.errorValidity,
      view: deps.errorView,
    };
  }

  // Run Plugin → identity → start rasterize → push into Slot. On throw
  // anywhere in Plugin.run / Renderer.identity, build an error Bundle and
  // push that instead. After `refillSlot` resolves, `slot.display()` is
  // guaranteed non-null.
  async function refillSlot(ctx: RunContext): Promise<void> {
    let bundle: Bundle;
    let identity: string;
    let image: Promise<Uint8Array>;
    try {
      bundle = await deps.pluginManager.run(ctx);
      identity = await deps.renderer.identity(bundle);
      image = deps.renderer.rasterize(bundle);
    } catch (err) {
      // Error path: re-enter the same loop with a fabricated error Bundle.
      // The error Bundle's `view` is the Server-supplied error view; its
      // `validity` is the Conductor's `errorValidity` (~30 s). Assets are
      // empty — the error view renders self-contained HTML.
      bundle = { result: errorResult(err), assets: {} };
      identity = await deps.renderer.identity(bundle);
      image = deps.renderer.rasterize(bundle);
    }
    deps.slot.put({
      bundle,
      identity,
      image,
      cachedAt: deps.now(),
    });
  }

  // Compute or look up the current display metadata. Tier 1: Slot still
  // valid → return its `display()` directly. Tier 3 (and Tier 2, not yet
  // implemented): refill the Slot, then return its `display()`.
  async function ensureDisplay(intent: RunContext["intent"]): Promise<SlotDisplay> {
    const cached = deps.slot.display();
    if (cached !== null) return cached;
    const ctx: RunContext = { t: deps.now(), intent, device: latestDevice };
    await refillSlot(ctx);
    const display = deps.slot.display();
    if (display === null) {
      throw new Error("Slot empty after refill — bundle validity must be > 0");
    }
    return display;
  }

  const app = new Hono()
    .get("/api/setup", (c) =>
      // `image_url` here is a placeholder — the BYOS firmware proceeds to
      // /api/display immediately after setup, which returns the real
      // identity-keyed URL. We hand back the same shape (/image/<id>.png)
      // pointing at `setup` so the field is syntactically a render URL.
      c.json({
        status: 200,
        api_key: "byos",
        friendly_id: deps.friendlyId,
        image_url: `${publicOrigin(c)}/image/setup.png`,
        message: "Welcome",
      }))
    .get("/api/display", async (c) => {
      const report = parseDeviceHeaders(c.req.raw.headers, deps.now);
      if (report) latestDevice = report;
      const display = await ensureDisplay("poll");
      const refreshRate = Math.max(
        1,
        Math.ceil(display.refreshIn.total({ unit: "seconds" })),
      );
      return c.json({
        status: 0,
        image_url: `${publicOrigin(c)}/image/${display.identity}.png`,
        filename: `image-${display.identity}`,
        refresh_rate: refreshRate,
        reset_firmware: false,
        update_firmware: false,
        firmware_url: "",
        special_function: "none",
        maximum_compatibility: true,
      });
    })
    .get("/image/:id{.+\\.png}", async (c) => {
      // `:id{.+\\.png}` matches "<identity>.png"; strip the extension to
      // get the Slot key. Identity mismatch (or empty / expired Slot)
      // returns 404 — the Device's next /api/display corrects.
      const param = c.req.param("id");
      const id = param.replace(/\.png$/, "");
      const bytes = await deps.slot.image(id);
      if (bytes === null) return c.notFound();
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "no-store",
      });
    })
    .post("/api/log", async (c) => {
      const body = await c.req.text();
      const id = c.req.raw.headers.get("id") ?? c.req.raw.headers.get("ID") ?? "(none)";
      deps.onDeviceLog?.(id, body);
      return c.body(null, 204);
    });

  return { app };
}
