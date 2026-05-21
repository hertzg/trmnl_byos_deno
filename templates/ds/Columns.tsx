/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type ColumnsProps = {
  count?: number;
  gap?: string;
  children?: JSX.Element | JSX.Element[] | string;
};

export function Columns({ count = 2, gap, children }: ColumnsProps) {
  const style: Record<string, string> = { "column-count": String(count) };
  if (gap !== undefined) style["column-gap"] = gap;
  return <div class="ds-columns" style={style}>{children}</div>;
}
