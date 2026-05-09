/** @jsxImportSource hono/jsx */
import type { Stop } from "./data.ts";
import StopSection from "./stop/StopSection.tsx";

// Departures rendered per (line, direction) group. Exactly 4 when the data has at
// least that many; the 12h fetch window in data.ts guarantees enough headroom even for
// sparse late-night lines.
const SLOT_LIMIT = 4;

export default function BVGTimetable({ stops }: { stops: Stop[] }) {
  return (
    <section class="section">
      {stops.map((stop) => <StopSection stop={stop} slotLimit={SLOT_LIMIT} />)}
    </section>
  );
}
