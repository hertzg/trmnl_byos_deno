/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

type Slot = JSX.Element | JSX.Element[] | string | number;

export type EmptyStateProps = {
  big: Slot;
  sub?: Slot;
};

export function EmptyState({ big, sub }: EmptyStateProps) {
  return (
    <div class="ds-empty-state">
      <div class="ds-empty-state__big">{big}</div>
      {sub !== undefined && <div class="ds-empty-state__sub">{sub}</div>}
    </div>
  );
}
