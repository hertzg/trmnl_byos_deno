import { assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { createConductor } from "../conductor/conductor.ts";
import type { RunContext } from "./plugin.ts";
import type { Bundle } from "./bundle.ts";
import { createPluginManager } from "./plugin-manager.ts";
import { createRenderer } from "../render/renderer.ts";
import { hashBundle } from "../hash.ts";
import { createSlot } from "../slot/slot.ts";
import { createTelemetry } from "../telemetry/telemetry.ts";
import { createDeviceState } from "../device-state.ts";

const T0 = Temporal.ZonedDateTime.from("2026-05-16T10:00[Europe/Berlin]");
const fiveMin = Temporal.Duration.from({ minutes: 5 });

async function writePluginDir(
  files: Record<string, string | Uint8Array>,
): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "plugin-manager-test-" });
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await Deno.mkdir(join(fullPath, ".."), { recursive: true });
    if (typeof content === "string") {
      await Deno.writeTextFile(fullPath, content);
    } else {
      await Deno.writeFile(fullPath, content);
    }
  }
  return dir;
}

const trivialPluginSource = `
  export default {
    run() {
      return {
        state: { ok: true },
        validity: Temporal.Duration.from({ minutes: 5 }),
        view: () => "<p>x</p>",
      };
    },
  };
`;

const ctx = (): RunContext => ({ t: T0, intent: "poll", device: null });

Deno.test("Bundle.assets is empty when the assets directory does not exist", async () => {
  const dir = await writePluginDir({ "main.ts": trivialPluginSource });

  const manager = await createPluginManager({ pluginDir: dir });
  const bundle = await manager.run(ctx());

  assertEquals(bundle.assets, {});
  assertEquals(bundle.result.state, { ok: true });
  assertEquals(
    bundle.result.validity.total({ unit: "minutes" }),
    fiveMin.total({ unit: "minutes" }),
  );
});

Deno.test("a file in assets/ becomes /assets/<name> keyed against its bytes", async () => {
  const dir = await writePluginDir({
    "main.ts": trivialPluginSource,
    "assets/foo.svg": "<svg/>",
  });

  const manager = await createPluginManager({ pluginDir: dir });
  const bundle = await manager.run(ctx());

  assertEquals(Object.keys(bundle.assets), ["/assets/foo.svg"]);
  assertEquals(new TextDecoder().decode(bundle.assets["/assets/foo.svg"]), "<svg/>");
});

Deno.test("run threads ctx straight through to plugin.run", async () => {
  // The Plugin echoes whatever it received back through state.intent, so an
  // assertion on the bundle's state verifies what the PluginManager passed in.
  const dir = await writePluginDir({
    "main.ts": `
      export default {
        run(ctx) {
          return {
            state: { intent: ctx.intent, deviceId: ctx.device?.id ?? null },
            validity: Temporal.Duration.from({ minutes: 5 }),
            view: () => "<p/>",
          };
        },
      };
    `,
  });

  const manager = await createPluginManager({ pluginDir: dir });
  const bundle = await manager.run({ t: T0, intent: "scrub", device: null });

  assertEquals(bundle.result.state, { intent: "scrub", deviceId: null });
});

Deno.test("every Bundle references the same in-memory asset map", async () => {
  // Reading the assets folder is a load-time cost; subsequent runs must hand
  // back the very same Record reference so the Renderer can rely on stable
  // identity for caching (and so the Plugin has no in-process mechanism to
  // mutate it).
  const dir = await writePluginDir({
    "main.ts": trivialPluginSource,
    "assets/foo.svg": "<svg/>",
  });

  const manager = await createPluginManager({ pluginDir: dir });
  const b1 = await manager.run(ctx());
  const b2 = await manager.run(ctx());

  assertStrictEquals(b1.assets, b2.assets);
});

Deno.test("binary file bytes survive the round-trip intact", async () => {
  // Mix every byte value plus a few common PNG-style header markers to catch
  // anything that goes through a text codec on the way in or out.
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const dir = await writePluginDir({
    "main.ts": trivialPluginSource,
    "assets/icon.png": bytes,
  });

  const manager = await createPluginManager({ pluginDir: dir });
  const bundle = await manager.run(ctx());

  assertEquals(bundle.assets["/assets/icon.png"], bytes);
});

Deno.test("a file inside a nested subdirectory keeps its full sub-path", async () => {
  const dir = await writePluginDir({
    "main.ts": trivialPluginSource,
    "assets/style.css": ".x { color: red; }",
    "assets/icons/bell.svg": "<svg id=bell/>",
    "assets/icons/transit/bus.svg": "<svg id=bus/>",
  });

  const manager = await createPluginManager({ pluginDir: dir });
  const bundle = await manager.run(ctx());

  assertEquals(
    new Set(Object.keys(bundle.assets)),
    new Set([
      "/assets/style.css",
      "/assets/icons/bell.svg",
      "/assets/icons/transit/bus.svg",
    ]),
  );
  assertEquals(new TextDecoder().decode(bundle.assets["/assets/icons/bell.svg"]), "<svg id=bell/>");
  assertEquals(
    new TextDecoder().decode(bundle.assets["/assets/icons/transit/bus.svg"]),
    "<svg id=bus/>",
  );
});

Deno.test("extraAssetRoots merge a folder's files under their declared urlPrefix", async () => {
  // The Gallery's drop-folder lives outside pluginDir/assets/ (ADR-0010). An
  // extra root makes its bytes reachable at the same /assets/gallery/<name>
  // URL the Gallery view points at, without those files sitting in the plugin.
  const dir = await writePluginDir({ "main.ts": trivialPluginSource });
  const gallery = await writePluginDir({
    "sunset.jpg": "PHOTO",
    "beach.png": "BEACH",
  });

  const manager = await createPluginManager({
    pluginDir: dir,
    extraAssetRoots: [{ dir: gallery, urlPrefix: "/assets/gallery/" }],
  });
  const bundle = await manager.run(ctx());

  assertEquals(
    new Set(Object.keys(bundle.assets)),
    new Set(["/assets/gallery/sunset.jpg", "/assets/gallery/beach.png"]),
  );
  assertEquals(new TextDecoder().decode(bundle.assets["/assets/gallery/sunset.jpg"]), "PHOTO");
});

Deno.test("extraAssetRoots: an absent drop-folder contributes nothing (empty-state)", async () => {
  const dir = await writePluginDir({ "main.ts": trivialPluginSource });

  const manager = await createPluginManager({
    pluginDir: dir,
    extraAssetRoots: [{ dir: "/no/such/drop/folder", urlPrefix: "/assets/gallery/" }],
  });
  const bundle = await manager.run(ctx());

  assertEquals(bundle.assets, {});
});

Deno.test("a PluginManager loaded from disk drives /api/display end-to-end through the Conductor", async () => {
  // Hermetic smoke test: write a Plugin to a temp dir, construct the
  // PluginManager + Conductor like main.ts does, hit /api/display, and
  // assert the BYOS-shaped JSON falls out the other side.
  const dir = await writePluginDir({
    "main.ts": `
      export default {
        run(ctx) {
          return {
            state: { intent: ctx.intent },
            validity: Temporal.Duration.from({ seconds: 120 }),
            view: (s) => "<p>" + s.intent + "</p>",
          };
        },
      };
    `,
    "assets/foo.svg": "<svg/>",
  });

  const pluginManager = await createPluginManager({ pluginDir: dir });
  const now = () => T0;
  const conductor = createConductor({
    pluginManager,
    renderer: {
      identity: (b: Bundle) => Promise.resolve("id-" + String(b.result.view(b.result.state))),
      rasterize: () => Promise.resolve(new Uint8Array()),
      // The Conductor doesn't touch origin/close on the /api/display path,
      // but the Renderer type requires them.
      origin: () => "http://127.0.0.1:0",
      close: () => Promise.resolve(),
    },
    slot: createSlot({ now }),
    telemetry: createTelemetry(),
    deviceState: createDeviceState({ now }),
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "SMOKE",
    now,
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.filename, "image-id-<p>poll</p>");
  assertEquals(body.refresh_rate, 120);
});

Deno.test("a PluginManager wired through the real Renderer surfaces a filename derived from hashBundle of the produced Bundle", async () => {
  // End-to-end smoke (slice #50): the Bundle PluginManager produces flows
  // into Renderer.identity, which delegates to hashBundle. The /api/display
  // filename must match the same hash a direct hashBundle call would
  // compute for the same Bundle (Result + assets).
  const dir = await writePluginDir({
    "main.ts": `
      export default {
        run(ctx) {
          return {
            state: { intent: ctx.intent, anchor: "smoke" },
            validity: Temporal.Duration.from({ seconds: 60 }),
            view: (s) => "<p>" + s.intent + ":" + s.anchor + "</p>",
          };
        },
      };
    `,
  });
  const pluginManager = await createPluginManager({ pluginDir: dir });

  // Real Renderer; the CDP-backed fetchPngFromUrl is stubbed because
  // /api/display doesn't take the rasterize path in this slice (pixels
  // come from /preview/png on the Dashboard sub-app, which doesn't run
  // here). The Renderer owns a loopback HTTP server, so we close it in
  // a try/finally to keep the test process tidy.
  const renderer = createRenderer({
    // Pin to 127.0.0.1 (default is "host.docker.internal" for the
    // production deno-task-dev workflow); tests bind on the loopback
    // interface so they don't expose an open port during the run.
    loopbackHost: "127.0.0.1",
    fetchPngFromUrl: () => Promise.resolve(new Uint8Array()),
  });

  try {
    const now = () => T0;
    const conductor = createConductor({
      pluginManager,
      renderer,
      slot: createSlot({ now }),
      telemetry: createTelemetry(),
      deviceState: createDeviceState({ now }),
      errorView: (_err: Error) => "",
      errorValidity: Temporal.Duration.from({ seconds: 30 }),
      friendlyId: "SMOKE",
      now,
    });

    const res = await conductor.app.request("/api/display");
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body.status, 0);
    // Reproduce the Bundle the PluginManager would build for an
    // intent=poll call and assert the filename matches its hashBundle.
    const expected = await pluginManager.run({ t: T0, intent: "poll", device: null });
    const expectedHash = await hashBundle(expected satisfies Bundle);
    assertEquals(body.filename, `image-${expectedHash}`);
    // 16-char lowercase hex per ADR-0004.
    assertEquals(/^image-[0-9a-f]{16}$/.test(body.filename), true);
    assertEquals(body.refresh_rate, 60);
  } finally {
    await renderer.close();
  }
});

Deno.test("end-to-end: /api/display → /image/<id>.png drives PluginManager → Renderer.rasterize through the production wiring and CDP fetches the loopback origin", async () => {
  // Full Device flow: Device polls /api/display → Conductor runs Plugin,
  // computes identity, starts eager rasterize, lands triple in the Slot →
  // Device follows up with /image/<identity>.png → Slot awaits the eager
  // rasterize and returns PNG bytes. Our stub fetchPngFromUrl plays CDP:
  // it really fetches the URL it's handed (proving Renderer's loopback
  // serves the Bundle's HTML + assets) and returns PNG-shaped bytes.
  const dir = await writePluginDir({
    "main.ts": `
      export default {
        run() {
          return {
            state: { msg: "ahoy from disk" },
            validity: Temporal.Duration.from({ minutes: 5 }),
            view: (s) => "<p>" + s.msg + "</p>",
          };
        },
      };
    `,
    "assets/style.css": ".x { color: red; }",
  });
  const pluginManager = await createPluginManager({ pluginDir: dir });

  // Boxed in an object so TS doesn't narrow the closure-captured `let`s to
  // `null` after the assignment is hidden behind a callback.
  const seen: { url: string | null; html: string | null; css: string | null } = {
    url: null,
    html: null,
    css: null,
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const renderer = createRenderer({
    // Pin to 127.0.0.1 so the test process can actually reach the loopback
    // origin via `fetch()`. The production default ("host.docker.internal")
    // only resolves inside the docker bridge.
    loopbackHost: "127.0.0.1",
    fetchPngFromUrl: async (url) => {
      seen.url = url;
      seen.html = await (await fetch(url)).text();
      seen.css = await (await fetch(new URL("/assets/style.css", new URL(url)))).text();
      return png;
    },
  });

  try {
    const now = () => T0;
    const conductor = createConductor({
      pluginManager,
      renderer,
      slot: createSlot({ now }),
      telemetry: createTelemetry(),
      deviceState: createDeviceState({ now }),
      errorView: (_err: Error) => "",
      errorValidity: Temporal.Duration.from({ seconds: 30 }),
      friendlyId: "SMOKE",
      now,
    });

    // Step 1: Device polls /api/display. Conductor refills the Slot
    // (Plugin → identity → eager rasterize → put). The response carries
    // the identity-keyed image URL.
    const displayRes = await conductor.app.request("/api/display");
    const display = await displayRes.json();
    assertEquals(display.status, 0);
    const path = new URL(display.image_url).pathname; // /image/<id>.png
    assertEquals(/^\/image\/[0-9a-f]{16}\.png$/.test(path), true, `bad image_url: ${path}`);

    // Step 2: Device follows up with /image/<identity>.png. Conductor
    // serves the Slot's bytes — the eager rasterize started in Step 1.
    const imgRes = await conductor.app.request(path);
    assertEquals(imgRes.status, 200);
    assertEquals(imgRes.headers.get("content-type"), "image/png");
    assertEquals(new Uint8Array(await imgRes.arrayBuffer()), png);

    // CDP-shaped fetcher saw a URL on the Renderer's loopback origin, not
    // the outward server.
    assertEquals(seen.url?.startsWith(renderer.origin() + "/"), true);
    // And it really fetched the Plugin's rendered HTML through the loopback.
    assertEquals(seen.html, "<!DOCTYPE html><p>ahoy from disk</p>");
    // The Bundle's asset is reachable on the same origin.
    assertEquals(seen.css, ".x { color: red; }");
  } finally {
    await renderer.close();
  }
});
