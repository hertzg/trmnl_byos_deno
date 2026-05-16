import type { DeviceReport, Plugin, Result, RunContext } from "../plugin/plugin.ts";

// The Conductor is opaque to the Plugin's state shape — `any` here is
// the orchestrator's "I don't know S, and I shouldn't have to" boundary.
// Plugin authors keep full type safety inside their own `run` and `view`.
export type RendererDep = {
  // deno-lint-ignore no-explicit-any
  deriveHtml(result: Result<any>): string | Promise<string>;
  rasterize(html: string, hints?: Record<string, unknown>): Promise<Uint8Array>;
};

export type ConductorDeps = {
  // deno-lint-ignore no-explicit-any
  plugin: Plugin<any>;
  renderer: RendererDep;
  identityFor: (html: string) => string | Promise<string>;
  errorView: (err: Error) => unknown;
  errorValidity: Temporal.Duration;
};

// What the trigger caller supplies — only the values that genuinely vary
// per call. `device` is intentionally absent: the Conductor owns the
// latest DeviceReport itself (fed via `reportDevice`) and reads it at
// trigger time. RunContext is constructed internally before forwarding
// to Plugin.run.
export type TriggerInput = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender";
};

export type TriggerOutput = {
  png: Uint8Array;
  identity: string;
  expiresAt: Temporal.ZonedDateTime;
};

export type Conductor = {
  trigger(input: TriggerInput): Promise<TriggerOutput>;
  getCurrentImage(identity: string): Uint8Array | undefined;
  reportDevice(report: DeviceReport): void;
};

export function createConductor(deps: ConductorDeps): Conductor {
  // deno-lint-ignore no-explicit-any
  type CurrentResult = { ctx: RunContext; result: Result<any> };
  type CurrentImage = { png: Uint8Array; identity: string };

  let currentResult: CurrentResult | null = null;
  let currentImage: CurrentImage | null = null;
  let latestDevice: DeviceReport | null = null;

  return {
    getCurrentImage(identity) {
      return currentImage?.identity === identity ? currentImage.png : undefined;
    },
    reportDevice(report) {
      latestDevice = report;
    },
    async trigger(input) {
      if (currentResult && currentImage) {
        const currentExpiry = currentResult.ctx.t.add(currentResult.result.validity);
        if (Temporal.ZonedDateTime.compare(input.t, currentExpiry) < 0) {
          return {
            png: currentImage.png,
            identity: currentImage.identity,
            expiresAt: currentExpiry,
          };
        }
      }
      const ctx: RunContext = {
        t: input.t,
        intent: input.intent,
        device: latestDevice,
      };
      // deno-lint-ignore no-explicit-any
      let result: Result<any>;
      try {
        result = await deps.plugin.run(ctx);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        result = {
          state: error,
          validity: deps.errorValidity,
          view: deps.errorView,
        };
      }
      const html = await deps.renderer.deriveHtml(result);
      const identity = await deps.identityFor(html);
      currentResult = { ctx, result };
      if (currentImage?.identity !== identity) {
        const png = await deps.renderer.rasterize(html, result.hints);
        currentImage = { png, identity };
      }
      return {
        png: currentImage.png,
        identity: currentImage.identity,
        expiresAt: input.t.add(result.validity),
      };
    },
  };
}
