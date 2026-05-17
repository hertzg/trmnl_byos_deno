import { Hono } from "hono";
import type { DeviceReport, RunContext } from "../plugin/plugin.ts";
import type { Bundle } from "../plugin/bundle.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Slot, SlotDisplay } from "../slot/slot.ts";
import type { RenderTrace, Telemetry } from "../telemetry/telemetry.ts";
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
  // Singleton that holds the most-recent RenderTrace. The Conductor
  // records exactly one trace per orchestration cycle — deferred until
  // the eager rasterize resolves so the trace's `durations.rasterize`
  // is the actual wall-clock and not a placeholder. The Dashboard reads
  // `telemetry.latest()` to render the trace strip.
  telemetry: Telemetry;
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
  // Single-flight: the in-flight refill (Plugin → identity → start
  // rasterize → Slot.put). Concurrent callers await the same promise so a
  // cache miss runs the Plugin exactly once even under burst load (e.g.
  // the Device's poll racing the Dashboard's in-process refill).
  // Set inside `refillSlot`, cleared in its `.finally` so the next miss
  // refills from scratch.
  let pendingRefill: Promise<void> | null = null;

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

  // Run Plugin → identity → push into Slot, with explicit timestamps
  // around each step so we can hand a complete RenderTrace to Telemetry
  // when the eager rasterize resolves. On throw anywhere in
  // `pluginManager.run` / `renderer.identity`, build an error Bundle and
  // run the same identity → rasterize sequence on it — the trace's
  // `error` field is set to the caught Error and the durations reflect
  // whatever ran before the throw plus the error-Bundle's identity +
  // rasterize times.
  //
  // Telemetry is recorded once per cycle (success or error), inside the
  // rasterize promise's `.finally`. Deferring the record means the trace
  // includes the real rasterize wall-clock — recording at `slot.put`
  // time would force a placeholder, and the Conductor returns from
  // `/api/display` before the rasterize promise resolves anyway.
  async function doRefill(ctx: RunContext): Promise<void> {
    const ranAt = deps.now();
    let pluginRunStart = ranAt;
    let pluginRunEnd = ranAt;
    let identityEnd = ranAt;
    let caught: Error | null = null;
    let bundle: Bundle;
    let identity: string;
    let image: Promise<Uint8Array>;
    try {
      pluginRunStart = deps.now();
      bundle = await deps.pluginManager.run(ctx);
      pluginRunEnd = deps.now();
      identity = await deps.renderer.identity(bundle);
      identityEnd = deps.now();
      image = deps.renderer.rasterize(bundle);
    } catch (err) {
      // Error path: re-enter the same loop with a fabricated error Bundle.
      // The error Bundle's `view` is the Server-supplied error view; its
      // `validity` is the Conductor's `errorValidity` (~30 s). Assets are
      // empty — the error view renders self-contained HTML.
      caught = err instanceof Error ? err : new Error(String(err));
      pluginRunEnd = deps.now();
      bundle = { result: errorResult(err), assets: {} };
      identity = await deps.renderer.identity(bundle);
      identityEnd = deps.now();
      image = deps.renderer.rasterize(bundle);
    }
    const rasterizeStart = identityEnd;
    // Record the trace once the eager rasterize completes (success or
    // failure). `.finally` runs even if `image` rejects — a CDP outage
    // mid-rasterize still gets a trace entry with the real timings up
    // to the failure point. The trailing `.catch(noop)` is essential:
    // `.finally` re-throws the upstream rejection on the chain we
    // create here, and that chain is otherwise dangling. The
    // underlying `image` promise the Slot stores keeps its rejection;
    // the /image/<id>.png handler is the only consumer that has to
    // observe it.
    image
      .finally(() => {
        const trace: RenderTrace = {
          ranAt,
          identity,
          durations: {
            pluginRun: pluginRunEnd.since(pluginRunStart),
            identity: identityEnd.since(pluginRunEnd),
            rasterize: deps.now().since(rasterizeStart),
          },
          error: caught,
        };
        deps.telemetry.record(trace);
      })
      .catch(() => {});
    deps.slot.put({
      bundle,
      identity,
      image,
      cachedAt: deps.now(),
    });
  }

  // Single-flight wrapper around doRefill: callers that arrive while a
  // refill is already in flight await the same promise rather than
  // kicking a second Plugin run. The pattern is inlined here (not
  // extracted) because the Conductor has exactly one of these and the
  // closure is small enough to read in place.
  function refillSlot(ctx: RunContext): Promise<void> {
    if (pendingRefill !== null) return pendingRefill;
    pendingRefill = doRefill(ctx).finally(() => {
      pendingRefill = null;
    });
    return pendingRefill;
  }

  // Compute or look up the current display metadata. Tier 1: Slot still
  // valid → return its `display()` directly. Tier 3 (and Tier 2, not yet
  // implemented): refill the Slot (deduped via `pendingRefill`), then
  // return its `display()`.
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
