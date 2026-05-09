/** @jsxImportSource hono/jsx */
import type { Departure } from "../data.ts";
import { hourMinute } from "./time.ts";

type Props = { dep: Departure; variant: "full" | "minute" };

function format({ dep, variant }: Props): string {
  const { hh, mm } = hourMinute(dep.when);
  if (dep.cancelled) return variant === "minute" ? "--" : `${hh}:--`;
  return variant === "minute" ? mm : `${hh}:${mm}`;
}

// Pure presentation: one styled label for one departure slot. Timeline decides which
// variant each pill gets (see the hour-collapse logic there).
export default function TimePill(props: Props) {
  return <span class="time-pill">{format(props)}</span>;
}
