/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

export type ContentProps = {
  children?: Child;
};

export function Content({ children }: ContentProps) {
  return <div class="ds-content">{children}</div>;
}
