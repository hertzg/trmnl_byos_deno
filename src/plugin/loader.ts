import { join, toFileUrl } from "@std/path";
import type { Plugin } from "./plugin.ts";

export async function loadPlugin(
  dir: string,
  config?: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<Plugin<any>> {
  const mainPath = join(dir, "main.ts");
  try {
    await Deno.stat(mainPath);
  } catch {
    throw new Error(`Plugin main.ts not found at ${mainPath}`);
  }

  const url = toFileUrl(mainPath).href;
  const mod = await import(url);
  if (typeof mod.default !== "function") {
    throw new Error(
      `Plugin at ${mainPath} must have a default export (factory function returning a Plugin)`,
    );
  }

  return await mod.default(config);
}
