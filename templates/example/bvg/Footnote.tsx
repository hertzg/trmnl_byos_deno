/** @jsxImportSource hono/jsx */

// Footnote — single-line clip summary rendered at the bottom of the panel
// when the hard row cap dropped one or more rows.
//
// Format: `+<totalDropped> later · <icon1>: <HH:MM>, <HH:MM> · <icon2>: <HH:MM>`
//
// Note: the v1 wireframe also shows an `arrive-by 10:00 / 10:00` tail; that
// info is OUT OF SCOPE for slice 10 and not rendered here.

import type { ClipSummary } from "./board_assembler.ts";
import { formatHHMM } from "./time.ts";

export default function Footnote(
  { clipSummary }: { clipSummary?: ClipSummary | null },
) {
  if (!clipSummary) return null;
  const visible = clipSummary.perIcon.filter((p) => p.count > 0);
  if (visible.length === 0) return null;
  const total = visible.reduce((sum, p) => sum + p.count, 0);
  return (
    <div class="footnote">
      <span class="footnote__chunk">+{total} later</span>
      {visible.map((p) => (
        <span key={p.icon} class="footnote__chunk">
          {" · "}
          {p.icon}: {p.nextLeaveBys.map((d) => formatHHMM(d)).join(", ")}
        </span>
      ))}
    </div>
  );
}
