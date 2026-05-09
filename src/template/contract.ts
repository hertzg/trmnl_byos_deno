import { join, toFileUrl } from "@std/path";

// New template ↔ runtime contract per ADR-0003. Lives alongside the legacy `loader.ts`
// during the transition; #5 will rename this into the loader slot and remove the old.

// Per-call overrides on stage-1 dimensions handed to services.renderJsx. Stage-2
// (bit depth, dither algorithm) is service-internal per ADR-0002 and intentionally
// absent.
export type RenderOpts = {
  width?: number;
  height?: number;
  dpr?: number;
};

// Minimal structural view of the services surface user code calls. The real
// implementation is in src/services/ (added under #2 / PR #7); this declaration is
// intentionally local so this file builds without that PR merged. #5 unifies them.
export type Services = {
  renderJsx(jsx: unknown, opts?: RenderOpts): Promise<string>;
};

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

export type SetupFn = (services: Services) => Promise<Registration>;

export type TemplateContract = {
  setup: SetupFn;
};

// Loads <dir>/main.ts and returns the new-contract shape. Throws if the module doesn't
// export a `setup` function. Mirrors the old loadTemplate's discovery logic.
export async function loadTemplateContract(dir: string): Promise<TemplateContract> {
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
  return mod as TemplateContract;
}
