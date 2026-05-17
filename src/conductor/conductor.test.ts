import { assertEquals, assertGreaterOrEqual, assertLessOrEqual } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { type ConductorDeps, createConductor } from "./conductor.ts";
import type { Plugin, RunContext } from "../plugin/plugin.ts";
import type { PluginManager } from "../plugin/plugin-manager.ts";
import type { Renderer } from "../render/renderer.ts";
import type { Bundle } from "../plugin/bundle.ts";
import { createSlot } from "../slot/slot.ts";

const at = (iso: string) => Temporal.ZonedDateTime.from(`${iso}[Europe/Berlin]`);
const T0 = at("2026-05-16T10:00");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

// Wrap a Plugin in a stub PluginManager so test bodies keep speaking
// "Plugin run returns ..." while the Conductor consumes a Bundle. The asset
// map is empty: nothing under test here consults it.
function managerFor(plugin: Plugin<unknown>): PluginManager {
  return {
    async run(ctx) {
      const result = await plugin.run(ctx);
      return { result, assets: {} };
    },
  };
}

// A fake Renderer whose `identity` derives a deterministic, inspectable
// string from the Bundle's rendered view output — tests can then assert on
// `out.identity` without re-implementing hashBundle. `rasterize` returns a
// short PNG-magic byte sequence so the /image/<id>.png route can hand back
// recognisable bytes without spinning CDP.
function fakeRenderer(overrides: Partial<Renderer> = {}): Renderer {
  return {
    identity: (b: Bundle) => Promise.resolve(`id-${String(b.result.view(b.result.state))}`),
    rasterize: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    origin: () => "http://127.0.0.1:0",
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function defaults(
  overrides: Partial<ConductorDeps> = {},
): Pick<
  ConductorDeps,
  "errorView" | "errorValidity" | "friendlyId" | "now" | "slot"
> {
  const now = overrides.now ?? (() => T0);
  return {
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "ID",
    now,
    slot: createSlot({ now }),
    ...overrides,
  };
}

// ─── /api/display: BYOS shape ──────────────────────────────────────────────

Deno.test("GET /api/display returns BYOS JSON with image_url=/image/<identity>.png and filename=image-<identity>", async () => {
  const conductor = createConductor({
    ...defaults(),
    pluginManager: managerFor({
      run: () => ({ state: {}, validity: fiveMin, view: () => "<p>x</p>" }),
    }),
    renderer: fakeRenderer({ identity: () => Promise.resolve("deadbeefcafef00d") }),
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.image_url, "http://localhost/image/deadbeefcafef00d.png");
  assertEquals(body.filename, "image-deadbeefcafef00d");
  assertGreaterOrEqual(body.refresh_rate, 299);
  assertLessOrEqual(body.refresh_rate, 300);
});
