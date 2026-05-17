/** @jsxImportSource hono/jsx */

// One actionable journey row. Layout per v3 wireframes:
//
//   [icon] [leave HH:MM]   [pictogram]                     [arrive HH:MM]   [dur]
//          was HH:MM                                       at <dest> · <pref>
//          leave <origin>
//          ⚠ +Nm delay
//          ⚠ <remark>
//
// Slice 6: the leave-by column carries the realtime "was" caption and the
// stack of ⚠ alert pills. Visual styling is left for a follow-up — `row__alert`
// is just a hook so the framework CSS can paint it later.

import type { Row as RowData } from "./journey_classifier.ts";
import { formatHHMM } from "./time.ts";
import Pictogram from "./Pictogram.tsx";

export default function Row({ row }: { row: RowData }) {
  const isShifted = row.leaveByDate.getTime() !== row.plannedLeaveByDate.getTime();
  const isImminent = row.imminence === "leave-now";
  const rowClass = isImminent ? "row row--leave-now" : "row";
  return (
    <div class={rowClass}>
      <div class="row__icon">{row.preferenceIcon}</div>
      <div class="row__leave">
        {formatHHMM(row.leaveByDate)}
        {isShifted && <small class="row__was">იყო {formatHHMM(row.plannedLeaveByDate)}</small>}
      </div>
      <Pictogram legs={row.legs} />
      <div class="row__arrive">
        {formatHHMM(row.arriveByDate)}
        <small>{row.destinationLabel} · {row.preferenceLabel}</small>
      </div>
      <div class="row__dur">{row.durationMinutes} წთ</div>
      {(row.alerts.length > 0 || isImminent) && (
        <div class="row__notes">
          {row.alerts.map((alert) => (
            <span class={`row__alert row__alert--${alert.kind}`}>⚠ {alert.text}</span>
          ))}
          {isImminent && <span class="row__leave-now">⚠ ახლავე გადი</span>}
        </div>
      )}
    </div>
  );
}
