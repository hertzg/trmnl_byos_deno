import { renderToString } from "hono/jsx/dom/server";

export function renderJsxToHtml<P>(component: (props: P) => unknown, props: P): string {
  return "<!DOCTYPE html>" + renderToString(component(props) as ReturnType<typeof renderToString>);
}
