import type { Registration, Services } from "../../src/template/loader.ts";
import Template from "./template.tsx";

// Lazy-render template: renderJsx is called inside onDisplay, so the CDP cost is paid
// on each device poll. Swap to pre-rendering by calling services.renderJsx in setup
// (or on a setInterval) and storing the resulting token in a closure variable that
// onDisplay reads — see ADR-0003.
export function setup(services: Services): Registration {
  return {
    async onDisplay(ctx) {
      const token = await services.renderJsx(
        Template({
          time: new Date().toISOString(),
          hostname: Deno.hostname(),
          deviceId: ctx.device.id || "(no ID header)",
        }),
      );
      return { token, refreshAfter: 60 };
    },
  };
}
