import { assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { createConductor } from "../conductor/conductor.ts";
import type { RunContext } from "./plugin.ts";
import type { Bundle } from "./bundle.ts";
import { createPluginManager } from "./plugin-manager.ts";

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
  const conductor = createConductor({
    pluginManager,
    renderer: {
      identity: (b: Bundle) => Promise.resolve("id-" + String(b.result.view(b.result.state))),
      rasterize: () => Promise.resolve(new Uint8Array()),
    },
    errorView: (_err: Error) => "",
    errorValidity: Temporal.Duration.from({ seconds: 30 }),
    friendlyId: "SMOKE",
    pluginAssetsDir: join(dir, "assets"),
    now: () => T0,
  });

  const res = await conductor.app.request("/api/display");
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.status, 0);
  assertEquals(body.filename, "image-id-<p>poll</p>");
  assertEquals(body.refresh_rate, 120);
});
