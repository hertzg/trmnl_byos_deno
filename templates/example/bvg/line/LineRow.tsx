/** @jsxImportSource hono/jsx */
import type { Group } from "../data.ts";
import Timeline from "../timeline/Timeline.tsx";
import LineLabel from "./LineLabel.tsx";
import ModeIcon from "./ModeIcon.tsx";

// One entry in a stop: a single (line, direction) pair. Icon on the left, label + pill
// timeline stacked on the right so the destination text gets the full content width.
export default function LineRow(
  { group, slotLimit }: { group: Group; slotLimit: number },
) {
  return (
    <div class="line-row">
      <div class="line-row__icon">
        <ModeIcon product={group.product} />
      </div>
      <div class="line-row__content">
        <LineLabel line={group.line} direction={group.direction} />
        <Timeline departures={group.departures} slotLimit={slotLimit} />
      </div>
    </div>
  );
}
