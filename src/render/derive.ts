import { renderToString } from "hono/jsx/dom/server";
import type { Result } from "../plugin/plugin.ts";

// deno-lint-ignore no-explicit-any
export function deriveHtml(result: Result<any>): string {
  const jsx = result.view(result.state) as Parameters<typeof renderToString>[0];
  return "<!DOCTYPE html>" + renderToString(jsx);
}
