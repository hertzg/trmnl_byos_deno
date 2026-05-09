/** @jsxImportSource hono/jsx */
import type { Stop } from "../data.ts";
import LineRow from "../line/LineRow.tsx";
import EmptyDepartures from "./EmptyDepartures.tsx";
import StopHeader from "./StopHeader.tsx";

// One stop's vertical block: its header, then either an empty placeholder or one
// LineRow per (line, direction) inside. Groups with fewer than `slotLimit` departures
// are dropped — a half-empty timeline (e.g. last-bus-of-the-day with one entry) wastes
// vertical space without adding much for the reader.
export default function StopSection(
  { stop, slotLimit }: { stop: Stop; slotLimit: number },
) {
  const groups = stop.groups.filter((g) => g.departures.length >= slotLimit);

  return (
    <>
      <StopHeader name={stop.name} />
      {groups.length === 0
        ? <EmptyDepartures />
        : groups.map((group) => (
          <LineRow
            key={`${group.line}|${group.direction}`}
            group={group}
            slotLimit={slotLimit}
          />
        ))}
    </>
  );
}
