// BVG (Berlin transport) departures fetch + filter + merge. The user's actual
// from-stop / walk time / lines live in `./routes.ts` (gitignored) — see
// `./routes.example.ts` for the starter template.

import { ROUTES } from "./routes.ts";

const BVG_BASE = "https://v6.bvg.transport.rest";

// Lookahead window for the single fetch. 12 hours is wide enough that any line running
// at least every ~3 hours yields enough departures to fill the layout, even at the
// last-bus-of-the-day case at 23:50.
const LOOKAHEAD_MIN = 720;

// BVG's `results` parameter defaults to 10 — at a busy interchange that's all
// S/U-Bahn before any night bus shows up. Bump it so we have headroom for filtering.
const MAX_RESULTS = 300;

export type Layout = "full" | "horizontal" | "vertical";

export type FilterSpec = {
  line?: string;
  direction?: string;
  // When true, departures matching this filter still appear in the table but are
  // never promoted to a hero card. Use for "informational" lines like FEX or
  // airport-bound regionals where the commute decision should be driven by other
  // entries.
  tableOnly?: boolean;
};

export type RoutesConfig = {
  title: string;
  stop: { id: string; name: string; walkMin: number };
  layout: Layout;
  filters: FilterSpec[];
};

export type Departure = {
  when: string;
  plannedWhen: string;
  delayMin: number | null;
  cancelled: boolean;
  realtime: boolean;
  line: string;
  direction: string;
  product: string;
  leaveBy: string;
  platform: string | null;
  tableOnly: boolean;
};

export type Board = {
  title: string;
  stop: { id: string; name: string; walkMin: number };
  layout: Layout;
  departures: Departure[];
};

type BvgDeparture = {
  when?: string | null;
  plannedWhen?: string | null;
  delay?: number | null;
  cancelled?: boolean;
  prognosisType?: string | null;
  direction?: string | null;
  platform?: string | null;
  plannedPlatform?: string | null;
  line?: { name?: string; product?: string };
};

const OPEN_DIRECTION = new Set(["", ".", ".*"]);

function directionMatches(pattern: string | undefined, text: string): boolean {
  if (pattern == null || OPEN_DIRECTION.has(pattern)) return true;
  return new RegExp(pattern, "i").test(text);
}

// Returns the first filter that matches, or null if none does. With no filters at
// all, every departure passes — equivalent to a single permissive filter — and
// `tableOnly` defaults to false. The "first match wins" rule lets the user prioritise
// entries by ordering: e.g. a heroable `S5 → Westkreuz` filter listed before a
// catch-all `S5` table-only filter promotes the commute direction but still lists
// the off-direction trains in the table.
function matchFilter(
  filters: FilterSpec[],
  dep: BvgDeparture,
): FilterSpec | null | undefined {
  if (filters.length === 0) return null;
  for (const f of filters) {
    if (f.line && dep.line?.name !== f.line) continue;
    if (!directionMatches(f.direction, dep.direction ?? "")) continue;
    return f;
  }
  return undefined;
}

function toDeparture(
  d: BvgDeparture,
  walkMin: number,
  tableOnly: boolean,
): Departure | null {
  const when = d.when ?? d.plannedWhen;
  if (!when) return null;
  const leaveBy = new Date(new Date(when).getTime() - walkMin * 60_000)
    .toISOString();
  return {
    when,
    plannedWhen: d.plannedWhen ?? when,
    delayMin: d.delay == null ? null : Math.round(d.delay / 60),
    cancelled: Boolean(d.cancelled),
    realtime: d.prognosisType != null,
    line: d.line?.name ?? "",
    direction: d.direction ?? "",
    product: d.line?.product ?? "",
    leaveBy,
    platform: d.platform ?? d.plannedPlatform ?? null,
    tableOnly,
  };
}

async function fetchDepartures(stopId: string): Promise<BvgDeparture[]> {
  const url =
    `${BVG_BASE}/stops/${stopId}/departures?duration=${LOOKAHEAD_MIN}&results=${MAX_RESULTS}&linesOfStops=false&remarks=true&language=en`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const body = await r.json() as { departures?: BvgDeparture[] };
    return body.departures ?? [];
  } catch {
    return [];
  }
}

export async function loadBvgBoard(): Promise<Board> {
  const { title, stop, layout, filters } = ROUTES;
  const raw = await fetchDepartures(stop.id);

  const now = Date.now();
  const departures = raw
    .map((d) => {
      const filter = matchFilter(filters, d);
      if (filter === undefined) return null;
      return toDeparture(d, stop.walkMin, filter?.tableOnly ?? false);
    })
    .filter((d): d is Departure => d !== null)
    .filter((d) => new Date(d.when).getTime() >= now)
    .sort((a, b) => a.when.localeCompare(b.when));

  return { title, stop, layout, departures };
}
