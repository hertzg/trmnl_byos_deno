import { join } from "@std/path";
import type { Bundle } from "./bundle.ts";
import { loadPlugin } from "./loader.ts";
import type { Plugin, RunContext } from "./plugin.ts";

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
  const plugin: Plugin<unknown> = await loadPlugin(deps.pluginDir);
  const assetsDir = join(deps.pluginDir, "assets");
  const assets = await readAssetsDir(assetsDir);

  return {
    async run(ctx) {
      const result = await plugin.run(ctx);
      return { result, assets };
    },
  };
}

async function readAssetsDir(_dir: string): Promise<Record<string, Uint8Array>> {
  // Cycle 1: directory may not exist. Subsequent cycles fill this in.
  return {};
}
