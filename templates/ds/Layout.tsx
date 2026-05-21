/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

export type LayoutProps = {
  bleed?: boolean;
  children?: Child;
};

export function Layout({ bleed, children }: LayoutProps) {
  const className = bleed ? "ds-layout ds-layout--bleed" : "ds-layout";
  return <div class={className}>{children}</div>;
}
