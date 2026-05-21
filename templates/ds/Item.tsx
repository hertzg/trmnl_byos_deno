/** @jsxImportSource hono/jsx */
import type { JSX } from "hono/jsx/jsx-runtime";

export type ItemEmphasis = "meta";

type Slot = JSX.Element | JSX.Element[] | string | number | null | undefined;

export interface ItemProps {
  meta?: Slot;
  content?: Slot;
  icon?: Slot;
  emphasis?: ItemEmphasis;
}

export function Item({ meta, content, icon, emphasis }: ItemProps) {
  const className = emphasis === "meta" ? "ds-item ds-item--meta-emphasis" : "ds-item";

  return (
    <div class={className}>
      <div class="ds-item__meta">{meta}</div>
      {icon !== undefined && <div class="ds-item__icon">{icon}</div>}
      <div class="ds-item__content">{content}</div>
    </div>
  );
}
