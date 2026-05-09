// BVG (Berlin transport) departures fetch + filter + group. Ported from the original
// TRMNL `Transport` plugin's transform_js. The user's actual stops/filters live in
// `./routes.ts` (gitignored) — see `./routes.example.ts` for the starter template.

import { ROUTES } from "./routes.ts";

const BVG_BASE = "https://v6.bvg.transport.rest";

// Per-stop lookahead used when a stop entry doesn't override it. 12 hours is wide
// enough that any line running at least every ~3 hours yields the 4-departure minimum
// the timeline targets, even for the last-bus-of-the-day case at 23:50.
const DEFAULT_STOP_DURATION_MIN = 720;

export type Departure = {
  when: string;
  plannedWhen: string;
  delayMin: number | null;
  cancelled: boolean;
  realtime: boolean;
};

export type Group = {
  line: string;
  direction: string;
  product: string;
  departures: Departure[];
};

export type Stop = {
  id: string;
  name: string;
  durationMin: number;
  total: number;
  groups: Group[];
};

type StopSpec = string | { id: string; durationMin?: number };

type FilterSpec = {
  line?: string;
  direction?: string;
  stops?: string[];
};

// Schema for the gitignored `./routes.ts` config. Exported so that file can type its
// constant against it without re-declaring the shape.
export type RoutesConfig = {
  stops: StopSpec[];
  filters?: FilterSpec[];
};

// What the BVG /departures endpoint hands back. Only the fields we actually consume are
// declared — everything else is dropped during normalization.
type BvgDeparture = {
  when?: string | null;
  plannedWhen?: string | null;
  delay?: number | null;
  cancelled?: boolean;
  prognosisType?: string | null;
  direction?: string | null;
  line?: { name?: string; product?: string };
  stop?: { name?: string };
};

type NormalizedStop = { id: string; durationMin: number };

const OPEN_FILTERS = new Set(["", ".", ".*"]);

function normalizeStop(spec: StopSpec): NormalizedStop | null {
  if (typeof spec === "string") {
    return { id: spec, durationMin: DEFAULT_STOP_DURATION_MIN };
  }
  if (spec && typeof spec === "object" && spec.id) {
    return {
      id: spec.id,
      durationMin: spec.durationMin ?? DEFAULT_STOP_DURATION_MIN,
    };
  }
  return null;
}

function directionMatches(pattern: string | undefined, text: string): boolean {
  if (pattern == null || OPEN_FILTERS.has(pattern)) return true;
  return new RegExp(pattern, "i").test(text);
}

function filterMatches(
  filter: FilterSpec,
  dep: BvgDeparture,
  stopId: string,
): boolean {
  if (filter.line && dep.line?.name !== filter.line) return false;
  if (!directionMatches(filter.direction, dep.direction ?? "")) return false;
  if (
    filter.stops && filter.stops.length > 0 && !filter.stops.includes(stopId)
  ) return false;
  return true;
}

function formatDeparture(d: BvgDeparture): Departure {
  return {
    when: (d.when ?? d.plannedWhen) ?? "",
    plannedWhen: d.plannedWhen ?? "",
    delayMin: d.delay == null ? null : Math.round(d.delay / 60),
    cancelled: Boolean(d.cancelled),
    realtime: d.prognosisType != null,
  };
}

// BVG's `results` parameter defaults to 10 — at a busy interchange that's all S/U-Bahn
// before any night bus shows up. Bump it so we have enough headroom that every line
// passes through the post-fetch filter with its 4-departure minimum intact.
const MAX_RESULTS_PER_STOP = 300;

async function fetchStop(
  stopId: string,
  durationMin: number,
): Promise<BvgDeparture[]> {
  const url =
    `${BVG_BASE}/stops/${stopId}/departures?duration=${durationMin}&results=${MAX_RESULTS_PER_STOP}&linesOfStops=false&remarks=true&language=en`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const body = await r.json() as { departures?: BvgDeparture[] };
    return body.departures ?? [];
  } catch {
    return [];
  }
}

function buildStop(
  spec: NormalizedStop,
  allDeps: BvgDeparture[],
  filters: FilterSpec[],
): Stop {
  const stopName = allDeps[0]?.stop?.name ?? spec.id;
  const included = filters.length === 0
    ? allDeps
    : allDeps.filter((dep) =>
      filters.some((f) => filterMatches(f, dep, spec.id))
    );

  const groupMap = new Map<string, Group>();
  for (const dep of included) {
    const line = dep.line?.name ?? "";
    const direction = dep.direction ?? "";
    const key = `${line}|${direction}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        line,
        direction,
        product: dep.line?.product ?? "",
        departures: [],
      };
      groupMap.set(key, group);
    }
    group.departures.push(formatDeparture(dep));
  }

  const groups = [...groupMap.values()].sort(
    (a, b) =>
      a.line.localeCompare(b.line) || a.direction.localeCompare(b.direction),
  );

  return {
    id: spec.id,
    name: stopName,
    durationMin: spec.durationMin,
    total: allDeps.length,
    groups,
  };
}

export async function loadBvgStops(): Promise<Stop[]> {
  const stopSpecs = ROUTES.stops.map(normalizeStop).filter((
    x,
  ): x is NormalizedStop => x !== null);
  const filters = ROUTES.filters ?? [];

  // Multiple stop entries may target the same stopId with different durations — keep the
  // largest so a single fetch covers every consumer.
  const maxDurByStop = new Map<string, number>();
  for (const s of stopSpecs) {
    maxDurByStop.set(
      s.id,
      Math.max(maxDurByStop.get(s.id) ?? 0, s.durationMin),
    );
  }

  const fetched = await Promise.all(
    [...maxDurByStop].map(async ([id, dur]) =>
      [id, await fetchStop(id, dur)] as const
    ),
  );
  const byStopId = new Map(fetched);

  return stopSpecs.map((s) => buildStop(s, byStopId.get(s.id) ?? [], filters));
}
