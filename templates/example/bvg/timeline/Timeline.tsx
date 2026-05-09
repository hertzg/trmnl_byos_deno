/** @jsxImportSource hono/jsx */
import type { Departure } from "../data.ts";
import { hourMinute } from "./time.ts";
import TimePill from "./TimePill.tsx";

type Cluster = {
  hh: string;
  pills: Array<{ dep: Departure; variant: "full" | "minute" }>;
};

// Groups consecutive departures sharing the same hour into clusters. The first pill
// of each cluster gets `variant: "full"` (renders "12:34"), the rest get `"minute"`
// (renders just "38"). The view then renders inter-cluster space wider than intra so
// the eye chunks the row by hour.
function clusterByHour(slice: Departure[]): Cluster[] {
  return slice.reduce<Cluster[]>((acc, dep) => {
    const { hh } = hourMinute(dep.when);
    const last = acc[acc.length - 1];
    if (last && last.hh === hh) {
      last.pills.push({ dep, variant: "minute" });
    } else {
      acc.push({ hh, pills: [{ dep, variant: "full" }] });
    }
    return acc;
  }, []);
}

export default function Timeline(
  { departures, slotLimit }: { departures: Departure[]; slotLimit: number },
) {
  const clusters = clusterByHour(departures.slice(0, slotLimit));

  return (
    <div class="timeline">
      {clusters.map((c, i) => (
        <div key={i} class="timeline__group">
          {c.pills.map((p, j) => <TimePill key={j} {...p} />)}
        </div>
      ))}
    </div>
  );
}
