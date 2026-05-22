import { join, toFileUrl } from "@std/path";
import type { Plugin } from "./plugin.ts";

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
