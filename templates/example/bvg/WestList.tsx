/** @jsxImportSource hono/jsx */
import type { Departure } from "./data.ts";
import LineBadge from "./LineBadge.tsx";
import LineGlyph from "./LineGlyph.tsx";
import { formatHHMM } from "./time.ts";

// Row layout shared by the vertical slot (with the small "გადით" label above each
// leave-by) and the full-screen slot's right column (without the label, since the
// hero card already establishes the "leave by" context).
//
// Columns: [glyph] [leave-by] [badge] [direction + departure]. The glyph leads so the
// eye picks up the mode (S/U/bus) before the time, then the line code, then the
// destination — matches how a regular departure board reads.

export default function WestList(
  { departures, withLeavePrefix = false }: {
    departures: Departure[];
    withLeavePrefix?: boolean;
  },
) {
  return (
    <div class="west-list">
      {departures.map((d) => (
        <div key={`${d.line}|${d.direction}|${d.when}`} class="west-list__row">
          <LineGlyph product={d.product} size="md" />
          <div class="west-list__leave">
            {withLeavePrefix && <span class="west-list__leave-prefix">გადით</span>}
            {formatHHMM(d.leaveBy)}
          </div>
          <LineBadge line={d.line} product={d.product} size="md" />
          <div>
            <div class="west-list__dir">→ {d.direction}</div>
            <div class="west-list__dep">
              {d.platform && (
                <>
                  <span class="platform">ბაქანი {d.platform}</span>
                  {" · "}
                </>
              )}
              გადის {formatHHMM(d.when)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
