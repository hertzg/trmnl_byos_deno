import { join, toFileUrl } from "@std/path";
import type { RenderOpts, Services } from "../services/index.ts";

export type { RenderOpts, Services };

// Device-derived data forwarded to user code each time the runtime asks the template
// what to display. Headers stay on the context as an escape hatch — anything firmware
// sends that we don't pre-parse is still reachable.
export type OnDisplayContext = {
  device: {
    id: string;
    panel: { width: number; height: number } | null;
    headers: Headers;
  };
  now: Date;
};

export type OnDisplayResult = {
  token: string;
  // Seconds until the device should poll /api/display again. Surfaces as `refresh_rate`
  // in the BYOS response. Template owns the device clock.
  refreshAfter: number;
};

export type OnDisplayFn = (ctx: OnDisplayContext) => Promise<OnDisplayResult>;

// What setup() returns. The closure is the template's state container; onDisplay reads
// from it. See ADR-0003 for the full shape rationale.
export type Registration = {
  onDisplay: OnDisplayFn;
};

export type SetupFn = (services: Services) => Registration | Promise<Registration>;

export type TemplateModule = {
  setup: SetupFn;
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
  if (typeof mod.setup !== "function") {
    throw new Error(`template at ${mainPath} must export a 'setup' function`);
  }
  return mod as TemplateModule;
}
