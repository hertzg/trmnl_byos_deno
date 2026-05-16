import { renderToString } from "hono/jsx/dom/server";
import type { Result } from "../plugin/plugin.ts";

export function deriveHtml(result: Result<unknown>): string {
  const jsx = result.view(result.state) as Parameters<typeof renderToString>[0];
  return "<!DOCTYPE html>" + renderToString(jsx);
}
