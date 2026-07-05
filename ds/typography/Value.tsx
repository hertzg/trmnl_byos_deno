/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type ValueSize =
  | "xxsmall"
  | "xsmall"
  | "small"
  | "base"
  | "medium"
  | "large"
  | "xlarge"
  | "xxlarge"
  | "xxxlarge"
  | "mega"
  | "giga"
  | "tera"
  | "peta";

export interface ValueProps {
  size?: ValueSize;
  tnums?: boolean;
  children?: JSX.Element | JSX.Element[] | string | number | null;
}

export function Value({ size = "base", tnums, children }: ValueProps) {
  const classes = ["ds-value"];
  if (size !== "base") classes.push(`ds-value--${size}`);
  if (tnums) classes.push("ds-value--tnums");
  return <span class={classes.join(" ")}>{children}</span>;
}
