import { join } from "@std/path";
import type { Bundle } from "./bundle.ts";
import { loadPlugin } from "./loader.ts";
import type { RunContext } from "./plugin.ts";
import { timed } from "../telemetry/spans.ts";

// Owns the Plugin's lifecycle: loads the module and its `assets/` folder
// once at construction, then attaches the same asset map to every Bundle
// it returns. See ADR-0002.

export type PluginManagerDeps = {
  pluginDir: string;
};

export type PluginManager = {
  run(ctx: RunContext): Promise<Bundle>;
};

export async function createPluginManager(
  deps: PluginManagerDeps,
): Promise<PluginManager> {
  const plugin = await loadPlugin(deps.pluginDir);
  const assetsDir = join(deps.pluginDir, "assets");
  const assets = await readAssetsDir(assetsDir);

  return {
    async run(ctx) {
      // `plugin.run` may be sync or async (see Plugin contract); the async
      // arrow lifts both cases to a Promise so `timed` can wrap it uniformly.
      const result = await timed("pluginRun", async () => plugin.run(ctx));
      return { result, assets };
    },
  };
}

// Recursive walk keyed by `/assets/<path>`. Empty map if the dir doesn't
// exist — a Plugin without assets is valid.
async function readAssetsDir(dir: string): Promise<Record<string, Uint8Array<ArrayBuffer>>> {
  const assets: Record<string, Uint8Array<ArrayBuffer>> = {};
  try {
    await Deno.stat(dir);
  } catch {
    return assets;
  }
  await collectFiles(dir, "", assets);
  return assets;
}

async function collectFiles(
  root: string,
  relativePrefix: string,
  out: Record<string, Uint8Array<ArrayBuffer>>,
): Promise<void> {
  for await (const entry of Deno.readDir(join(root, relativePrefix))) {
    const childRelative = relativePrefix === "" ? entry.name : `${relativePrefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collectFiles(root, childRelative, out);
    } else if (entry.isFile) {
      const bytes = await Deno.readFile(join(root, childRelative));
      out[`/assets/${childRelative}`] = bytes;
    }
  }
}
