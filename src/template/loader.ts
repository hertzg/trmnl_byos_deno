import { join, toFileUrl } from "@std/path";
import type { RunFn } from "./run.ts";

export type TemplateModule = {
  run: RunFn;
};

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
