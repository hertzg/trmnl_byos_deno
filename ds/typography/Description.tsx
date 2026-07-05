/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type DescriptionSize =
  | "xsmall"
  | "small"
  | "base"
  | "medium"
  | "large"
  | "xlarge"
  | "xxlarge";

export interface DescriptionProps {
  size?: DescriptionSize;
  children?: JSX.Element | JSX.Element[] | string | number | null;
}

export function Description({ size = "base", children }: DescriptionProps) {
  const className = size === "base" ? "ds-description" : `ds-description ds-description--${size}`;
  return <span class={className}>{children}</span>;
}
