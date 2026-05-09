import type { Registration, SetupConfig } from "../../src/template/loader.ts";
import Template from "./template.tsx";

// Lazy template: onDisplay returns fresh JSX each time the renderer asks. The renderer
// decides how often that happens (a single canonical render is shared across all devices
// polling within `validForSeconds`). To pre-render, do the work in setup() and have
// onDisplay return a captured JSX from this closure.
export function setup(config: SetupConfig): Registration {
  return {
    onDisplay() {
      return {
        jsx: Template({
          time: new Date().toISOString(),
          hostname: Deno.hostname(),
          panel: `${config.panel.width}×${config.panel.height}`,
        }),
        validForSeconds: 60,
      };
    },
  };
}
