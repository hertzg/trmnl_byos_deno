import type { Plugin, Result, RunContext } from "../plugin/plugin.ts";

// The Conductor is opaque to the Plugin's state shape — `any` here is
// the orchestrator's "I don't know S, and I shouldn't have to" boundary.
// Plugin authors keep full type safety inside their own `run` and `view`.
// deno-lint-ignore no-explicit-any
export type RendererDep = {
  deriveHtml(result: Result<any>): string | Promise<string>;
  rasterize(html: string, hints?: Record<string, unknown>): Promise<Uint8Array>;
};

// deno-lint-ignore no-explicit-any
export type ConductorDeps = {
  plugin: Plugin<any>;
  renderer: RendererDep;
  identityFor: (html: string) => string;
};

export type TriggerOutput = {
  png: Uint8Array;
  identity: string;
};

export type Conductor = {
  trigger(ctx: RunContext): Promise<TriggerOutput>;
};

export function createConductor(deps: ConductorDeps): Conductor {
  // deno-lint-ignore no-explicit-any
  type CurrentResult = { ctx: RunContext; result: Result<any> };
  type CurrentImage = { png: Uint8Array; identity: string };

  let currentResult: CurrentResult | null = null;
  let currentImage: CurrentImage | null = null;

  return {
    async trigger(ctx) {
      if (
        currentResult && currentImage &&
        Temporal.ZonedDateTime.compare(
          ctx.t,
          currentResult.ctx.t.add(currentResult.result.validity),
        ) < 0
      ) {
        return { png: currentImage.png, identity: currentImage.identity };
      }
      const result = await deps.plugin.run(ctx);
      const html = await deps.renderer.deriveHtml(result);
      const identity = deps.identityFor(html);
      currentResult = { ctx, result };
      if (currentImage?.identity !== identity) {
        const png = await deps.renderer.rasterize(html, result.hints);
        currentImage = { png, identity };
      }
      return { png: currentImage.png, identity: currentImage.identity };
    },
  };
}
