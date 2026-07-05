/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";

export type ContentProps = {
  children?: Child;
};

export function Content({ children }: ContentProps): JSX.Element {
  return <div class="ds-content">{children}</div>;
}
