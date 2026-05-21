/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type FlexAlign = "start" | "center" | "end" | "baseline" | "stretch";
export type FlexJustify = "start" | "center" | "end" | "space-between" | "space-around";
export type FlexDirection = "row" | "col";

export type FlexProps = {
  direction?: FlexDirection;
  gap?: string;
  align?: FlexAlign;
  justify?: FlexJustify;
  wrap?: boolean;
  children?: JSX.Element | JSX.Element[] | string;
};

const alignMap: Record<FlexAlign, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  baseline: "baseline",
  stretch: "stretch",
};

const justifyMap: Record<FlexJustify, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  "space-between": "space-between",
  "space-around": "space-around",
};

export function Flex(
  { direction = "row", gap, align, justify, wrap, children }: FlexProps,
) {
  const classes = ["ds-flex", direction === "col" ? "ds-flex--col" : "ds-flex--row"];
  if (wrap) classes.push("ds-flex--wrap");

  const style: Record<string, string> = {};
  if (gap !== undefined) style.gap = gap;
  if (align !== undefined) style["align-items"] = alignMap[align];
  if (justify !== undefined) style["justify-content"] = justifyMap[justify];
  const hasStyle = Object.keys(style).length > 0;

  return <div class={classes.join(" ")} style={hasStyle ? style : undefined}>{children}</div>;
}
