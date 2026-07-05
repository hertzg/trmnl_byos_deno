/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type TitleSize =
  | "xsmall"
  | "small"
  | "base"
  | "medium"
  | "large"
  | "xlarge"
  | "xxlarge";

export interface TitleProps {
  size?: TitleSize;
  children?: JSX.Element | JSX.Element[] | string | number | null;
}

export function Title({ size = "base", children }: TitleProps) {
  const className = size === "base" ? "ds-title" : `ds-title ds-title--${size}`;
  return <span class={className}>{children}</span>;
}
