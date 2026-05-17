import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { RunContext } from "./plugin.ts";
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
  assertEquals(bundle.result.validity.total({ unit: "minutes" }), fiveMin.total({ unit: "minutes" }));
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
