import { join } from "@std/path";
import type { Bundle } from "./bundle.ts";
import { loadPlugin } from "./loader.ts";
import type { RunContext } from "./plugin.ts";
import { timed } from "../telemetry/spans.ts";

// Owns the Plugin's lifecycle: loads the module and its `assets/` folder
// once at construction, then attaches the same asset map to every Bundle
// it returns. See ADR-0002.

// An author-owned folder that lives outside the Plugin's own `assets/` tree but
// whose bytes must still be served. Its files are merged into the same asset map
// under `urlPrefix`, so a view's `<img src="${urlPrefix}name">` resolves. Used
// for the Gallery's mounted drop-folder (ADR-0010); the prefix is declared
// explicitly at the wiring site, not scanned implicitly from config/.
export type AssetRoot = {
  dir: string;
  // URL prefix the folder's files are keyed under, e.g. "/assets/gallery/".
  // A trailing slash is added if missing.
  urlPrefix: string;
};

export type PluginManagerDeps = {
  pluginDir: string;
  extraAssetRoots?: AssetRoot[];
};

export type PluginManager = {
  run(ctx: RunContext): Promise<Bundle>;
};

export async function createPluginManager(
  deps: PluginManagerDeps,
): Promise<PluginManager> {
  const plugin = await loadPlugin(deps.pluginDir);

  // The served asset map: the Plugin's own `assets/` tree, plus any explicitly
  // declared extra roots (e.g. the Gallery drop-folder). All read once here.
  const assets: Record<string, Uint8Array<ArrayBuffer>> = {};
  await collectAssetRoot(join(deps.pluginDir, "assets"), "/assets/", assets);
  for (const root of deps.extraAssetRoots ?? []) {
    const prefix = root.urlPrefix.endsWith("/") ? root.urlPrefix : `${root.urlPrefix}/`;
    await collectAssetRoot(root.dir, prefix, assets);
  }

  return {
    async run(ctx) {
      // `plugin.run` may be sync or async (see Plugin contract); the async
      // arrow lifts both cases to a Promise so `timed` can wrap it uniformly.
      const result = await timed("pluginRun", async () => plugin.run(ctx));
      return { result, assets };
    },
  };
}

// Recursively walk `dir`, keying each file as `${keyPrefix}<sub/path>` into
// `out`. A missing dir contributes nothing — a Plugin without assets, or an
// empty/absent drop-folder, is valid.
async function collectAssetRoot(
  dir: string,
  keyPrefix: string,
  out: Record<string, Uint8Array<ArrayBuffer>>,
): Promise<void> {
  try {
    await Deno.stat(dir);
  } catch {
    return;
  }
  await collectFiles(dir, "", keyPrefix, out);
}

async function collectFiles(
  root: string,
  relativePrefix: string,
  keyPrefix: string,
  out: Record<string, Uint8Array<ArrayBuffer>>,
): Promise<void> {
  for await (const entry of Deno.readDir(join(root, relativePrefix))) {
    const childRelative = relativePrefix === "" ? entry.name : `${relativePrefix}/${entry.name}`;
    if (entry.isDirectory) {
      await collectFiles(root, childRelative, keyPrefix, out);
    } else if (entry.isFile) {
      const bytes = await Deno.readFile(join(root, childRelative));
      out[`${keyPrefix}${childRelative}`] = bytes;
    }
  }
}
