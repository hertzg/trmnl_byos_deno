/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type LayoutProps = {
  bleed?: boolean;
  children?: JSX.Element | JSX.Element[] | string;
};

export function Layout({ bleed, children }: LayoutProps) {
  const className = bleed ? "ds-layout ds-layout--bleed" : "ds-layout";
  return <div class={className}>{children}</div>;
}
