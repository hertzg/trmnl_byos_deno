/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";

export type GridProps = {
  cols?: number | string;
  gap?: string;
  children?: Child;
};

export function Grid({ cols, gap, children }: GridProps): JSX.Element {
  const style: Record<string, string> = {};
  if (cols !== undefined) {
    style["grid-template-columns"] = typeof cols === "number" ? `repeat(${cols}, 1fr)` : cols;
  }
  if (gap !== undefined) style.gap = gap;
  const hasStyle = Object.keys(style).length > 0;
  return <div class="ds-grid" style={hasStyle ? style : undefined}>{children}</div>;
}
