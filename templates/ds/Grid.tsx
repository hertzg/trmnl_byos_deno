/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type GridProps = {
  cols?: number | string;
  gap?: string;
  children?: JSX.Element | JSX.Element[] | string;
};

export function Grid({ cols, gap, children }: GridProps) {
  const style: Record<string, string> = {};
  if (cols !== undefined) {
    style["grid-template-columns"] = typeof cols === "number" ? `repeat(${cols}, 1fr)` : cols;
  }
  if (gap !== undefined) style.gap = gap;
  const hasStyle = Object.keys(style).length > 0;
  return <div class="ds-grid" style={hasStyle ? style : undefined}>{children}</div>;
}
