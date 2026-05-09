import type { RunContext, RunResult } from "../../src/template/run.ts";
import type { DitherMode } from "../../src/render/dither.ts";
import Template, { type DefaultProps } from "./template.tsx";

const DITHER_CYCLE: DitherMode[] = ["floyd-steinberg", "atkinson", "sierra3", "bayer", "none"];

// Module-level state — survives across run() calls within the process. With touchbar_mode
// unset (gesture mode), each tap re-polls /api/display which re-fetches /image.png, so each
// tap advances one mode. Restart resets.
let pollCount = 0;

export function run(ctx: RunContext): RunResult<DefaultProps> {
  // In preview mode we don't advance the cycle — that would make the device's served image
  // change every time someone refreshes the browser preview.
  const isDevice = ctx.kind === "device";
  if (isDevice) pollCount++;

  const dither: DefaultProps["dither"] = isDevice
    ? DITHER_CYCLE[pollCount % DITHER_CYCLE.length]
    : "(preview)";

  // Fall back to TRMNL X CSS-pixel viewport when the request didn't carry a panel size.
  const width = ctx.panel ? Math.round(ctx.panel.width / 1.8) : 1040;
  const height = ctx.panel ? Math.round(ctx.panel.height / 1.8) : 780;

  return {
    component: Template,
    props: {
      time: new Date().toISOString(),
      hostname: Deno.hostname(),
      dither,
      bitDepth: isDevice ? 4 : "—",
      width,
      height,
      dpr: 1.8,
    },
    render: isDevice
      ? { dither: DITHER_CYCLE[pollCount % DITHER_CYCLE.length], bitDepth: 4 }
      : undefined,
  };
}
