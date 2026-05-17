import { join, toFileUrl } from "@std/path";
import type { Plugin } from "./plugin.ts";

// Copies `source` into `target` only when `target` is empty (or doesn't exist).
// Used to seed a fresh bind-mount with the bundled example: first run gets
// files; subsequent runs preserve the user's edits. Anything in `target` (even
// unrelated files) blocks seeding — the user empties the dir on the host to
// re-seed.
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

// Type predicate that lets loadPlugin return Plugin<unknown> without an `as`
// cast: once isPlugin returns true, TypeScript narrows the value to the
// Plugin shape. Kept exported so it can be tested directly — the loader's
// error-message guards still live in loadPlugin because they need the
// mainPath for context.
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
