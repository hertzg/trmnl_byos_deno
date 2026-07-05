/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type LabelSize =
  | "xsmall"
  | "small"
  | "base"
  | "medium"
  | "large"
  | "xlarge"
  | "xxlarge";

export interface LabelProps {
  size?: LabelSize;
  muted?: boolean;
  children?: JSX.Element | JSX.Element[] | string | number | null;
}

export function Label({ size = "base", muted, children }: LabelProps): JSX.Element {
  const classes = ["ds-label"];
  if (size !== "base") classes.push(`ds-label--${size}`);
  if (muted) classes.push("ds-label--muted");
  return <span class={classes.join(" ")}>{children}</span>;
}
