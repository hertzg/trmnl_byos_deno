/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";

export type LayoutProps = {
  bleed?: boolean;
  children?: Child;
};

export function Layout({ bleed, children }: LayoutProps): JSX.Element {
  const className = bleed ? "ds-layout ds-layout--bleed" : "ds-layout";
  return <div class={className}>{children}</div>;
}
