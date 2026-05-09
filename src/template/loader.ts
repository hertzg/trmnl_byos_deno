import { join, toFileUrl } from "@std/path";
import type { RunFn } from "./run.ts";

export type TemplateModule = {
  run: RunFn;
};

// Copies `source` into `target` only when `target` is empty (or doesn't exist). Used to
// seed a fresh bind-mount with the bundled example: first run gets files; subsequent runs
// preserve the user's edits. Anything in `target` (even unrelated files) blocks seeding —
// the user empties the dir on the host to re-seed.
export async function seedTemplateDir(target: string, source: string): Promise<void> {
  await Deno.mkdir(target, { recursive: true });
  for await (const _ of Deno.readDir(target)) {
    return;
  }
  console.log(`[template] seeding empty ${target} from ${source}`);
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

// Loads the user-provided template at <dir>/main.ts via dynamic import. Process-lifetime;
// to pick up edits, restart (deno --watch does this automatically when files in the
// watched paths change).
export async function loadTemplate(dir: string): Promise<TemplateModule> {
  const mainPath = join(dir, "main.ts");
  try {
    await Deno.stat(mainPath);
  } catch {
    throw new Error(`template main.ts not found at ${mainPath}`);
  }

  const url = toFileUrl(mainPath).href;
  const mod = await import(url);
  if (typeof mod.run !== "function") {
    throw new Error(`template at ${mainPath} must export a 'run' function`);
  }
  return mod as TemplateModule;
}
