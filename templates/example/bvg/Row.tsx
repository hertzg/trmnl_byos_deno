/** @jsxImportSource hono/jsx */

// One actionable journey row. Layout per v3 wireframes:
//
//   [icon] [leave HH:MM]   [pictogram]                     [arrive HH:MM]   [dur]
//                                                          at <dest> · <pref>
//          leave <origin>
//
// Slice 1: no realtime alert pill, no prep-buffer time, no exclusion. Those
// arrive in slices 4/5.

import type { Row as RowData } from "./journey_classifier.ts";
import { formatHHMM } from "./time.ts";
import Pictogram from "./Pictogram.tsx";

export default function Row({ row }: { row: RowData }) {
  return (
    <div class="row">
      <div class="row__icon">{row.preferenceIcon}</div>
      <div class="row__leave">
        {formatHHMM(row.leaveByDate)}
        <small>leave {row.originLabel}</small>
      </div>
      <Pictogram legs={row.legs} />
      <div class="row__arrive">
        {formatHHMM(row.arriveByDate)}
        <small>at {row.destinationLabel} · {row.preferenceLabel}</small>
      </div>
      <div class="row__dur">{row.durationMinutes} min</div>
    </div>
  );
}
