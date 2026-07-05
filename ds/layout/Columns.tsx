/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";

export type ColumnsProps = {
  count?: number;
  gap?: string;
  children?: Child;
};

export function Columns({ count = 2, gap, children }: ColumnsProps): JSX.Element {
  const style: Record<string, string> = { "column-count": String(count) };
  if (gap !== undefined) style["column-gap"] = gap;
  return <div class="ds-columns" style={style}>{children}</div>;
}
