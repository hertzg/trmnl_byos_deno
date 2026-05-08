import { renderToString } from "hono/jsx/dom/server";
import DefaultTemplate, { type DefaultProps } from "../../templates/default.tsx";

export function renderDefault(props: DefaultProps): string {
  return "<!DOCTYPE html>" + renderToString(DefaultTemplate(props));
}
