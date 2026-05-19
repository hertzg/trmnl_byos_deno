import { join, toFileUrl } from "@std/path";
import type { Plugin } from "./plugin.ts";

// Seeds `target` from `source` only when `target` is empty — the user
// re-seeds by emptying the directory on the host.
export async function seedPluginDir(target: string, source: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const _ of Deno.readDir(target)) {
    return;
  }
  console.log(`[plugin] seeding empty ${target} from ${source}`);
  await copyDirContents(source, target);
}

async function copyDirContents(src: string, dst: string): Promise<void> {
  for await (const entry of Deno.readDir(src)) {
    const sp = join(src, entry.name);
    const dp = join(dst, entry.name);
    if (entry.isDirectory) {
      await Deno.mkdir(dp, { recursive: true });
      await copyDirContents(sp, dp);
    } else if (entry.isFile) {
      await Deno.copyFile(sp, dp);
    } else if (entry.isSymlink) {
      await Deno.symlink(await Deno.readLink(sp), dp);
    }
  }
}

export function isPlugin(value: unknown): value is Plugin<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "run" in value &&
    typeof (value as { run: unknown }).run === "function"
  );
}

export async function loadPlugin(dir: string): Promise<Plugin<unknown>> {
  const mainPath = join(dir, "main.ts");
  try {
    await Deno.stat(mainPath);
  } catch {
    throw new Error(`Plugin main.ts not found at ${mainPath}`);
  }

  const url = toFileUrl(mainPath).href;
  const mod = await import(url);
  if (mod.default === undefined || mod.default === null) {
    throw new Error(
      `Plugin at ${mainPath} must have a default export (a Plugin object with a run method)`,
    );
  }
  if (!isPlugin(mod.default)) {
    throw new Error(
      `Plugin at ${mainPath} default export must be a Plugin object with a run method`,
    );
  }

  return mod.default;
}
