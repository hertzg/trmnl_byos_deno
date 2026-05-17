import { join } from "@std/path";
import type { Bundle } from "./bundle.ts";
import { loadPlugin } from "./loader.ts";
import type { RunContext } from "./plugin.ts";

// The PluginManager owns the Plugin's lifecycle: it loads the Plugin module
// once at construction, reads its `assets/` directory recursively into memory
// once at construction, and exposes one method — `run(ctx) → Bundle` — that
// calls `plugin.run(ctx)` and attaches the (same) asset map to every Bundle
// it returns. The asset map is captured by closure; from the Plugin's
// perspective there is no way to mutate it.

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
      const result = await plugin.run(ctx);
      return { result, assets };
    },
  };
}

// Walks `dir` recursively and returns every file keyed by its public URL path
// (`/assets/<path-relative-to-dir>`). Reads file bytes raw — binary and text
// flow through identically. Returns an empty map if `dir` does not exist,
// because a Plugin without an `assets/` folder is valid (its view simply
// references no assets).
async function readAssetsDir(dir: string): Promise<Record<string, Uint8Array>> {
  const assets: Record<string, Uint8Array> = {};
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
  out: Record<string, Uint8Array>,
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
