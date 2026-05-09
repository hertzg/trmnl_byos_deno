import { renderJsxToHtml } from "../render/template.ts";
import { RENDER_DEFAULTS } from "../config.ts";
import type { DitherMode } from "../render/dither.ts";
import ErrorCard from "./error-card.tsx";
import type { TemplateModule } from "./loader.ts";

// "preview" = HTML route (browser); "device" = PNG route (firmware or browser fetching the
// image). Templates can branch on this to e.g. show debug overlays only in preview.
export type DisplayKind = "preview" | "device";

export type RunContext = {
  kind: DisplayKind;
  url: URL;
  query: Record<string, string>;
  headers: Headers;
  // Device-reported panel size in physical pixels, parsed from Width/Height request headers.
  // Null on preview requests, and on device requests where the device didn't send them.
  panel: { width: number; height: number } | null;
};

export type RenderOverrides = Partial<{
  dither: DitherMode;
  bitDepth: 1 | 2 | 4 | 8;
  dpr: number;
  width: number;
  height: number;
}>;

// run() returns a JSX-component-like function plus props. The service calls component(props)
// and feeds the result through renderToString. `render` is an optional per-request override
// of service-level render defaults.
export type RunResult<TProps = unknown> = {
  component: (props: TProps) => unknown;
  props: TProps;
  render?: RenderOverrides;
};

export type RunFn = (ctx: RunContext) => Promise<RunResult> | RunResult;

export type ResolvedRender = {
  width: number;
  height: number;
  dpr: number;
  bitDepth: 1 | 2 | 4 | 8;
  dither: DitherMode;
};

export type RunOutcome = {
  html: string;
  render: ResolvedRender;
};

// Calls template.run(ctx); on any throw, substitutes the built-in error card.
// Caller-provided overrides (e.g. query-string debug knobs on /image.png) win over both
// run()'s render hint and service defaults — that's the whole point of those query params.
export async function runTemplate(
  template: TemplateModule,
  ctx: RunContext,
  callerOverrides: RenderOverrides = {},
): Promise<RunOutcome> {
  try {
    const result = await template.run(ctx);
    const render = mergeRender(result.render, callerOverrides);
    const html = renderJsxToHtml(result.component, result.props);
    return { html, render };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[template]", e);
    const html = renderJsxToHtml(ErrorCard, {
      kind: ctx.kind,
      message: e.message,
      stack: e.stack,
    });
    return { html, render: mergeRender(undefined, callerOverrides) };
  }
}

function mergeRender(
  fromRun: RenderOverrides | undefined,
  fromCaller: RenderOverrides,
): ResolvedRender {
  return {
    width: fromCaller.width ?? fromRun?.width ?? RENDER_DEFAULTS.width,
    height: fromCaller.height ?? fromRun?.height ?? RENDER_DEFAULTS.height,
    dpr: fromCaller.dpr ?? fromRun?.dpr ?? RENDER_DEFAULTS.dpr,
    bitDepth: fromCaller.bitDepth ?? fromRun?.bitDepth ?? RENDER_DEFAULTS.bitDepth,
    dither: fromCaller.dither ?? fromRun?.dither ?? RENDER_DEFAULTS.dither,
  };
}
