/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type StatusBarProps = {
  position?: "top" | "bottom";
  children?: JSX.Element | JSX.Element[] | string | number | null;
};

export function StatusBar({ position = "bottom", children }: StatusBarProps): JSX.Element {
  const className = `ds-status-bar ds-status-bar--${position}`;
  if (position === "top") {
    return <header class={className}>{children}</header>;
  }
  return <footer class={className}>{children}</footer>;
}
