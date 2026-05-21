/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type ContentProps = {
  children?: JSX.Element | JSX.Element[] | string;
};

export function Content({ children }: ContentProps) {
  return <div class="ds-content">{children}</div>;
}
