// BvgJourneyClient — anti-corruption layer to https://v6.bvg.transport.rest/journeys.
//
// Maps the HAFAS-shaped JSON returned by the BVG REST mirror into the journey
// board's domain value objects: `Candidate`, `Leg`, `Line`, `RealtimeAnnotation`.
// Walking-leg vs transit-leg discrimination is decided here, so the rest of the
// pipeline only ever sees clean discriminated unions.

import type { Place } from "./preference.ts";

const BVG_JOURNEYS_URL = "https://v6.bvg.transport.rest/journeys";

// Hard ceiling on a single /journeys call. The board's refresh cadence is in
// the 30–300s range (see DEFAULTS), so anything slower than ~10s would
// already be on track to miss the next refresh — fail fast and let the
// pipeline render `feedUnreachable` instead of holding the request open.
const FETCH_TIMEOUT_MS = 10_000;

// HAFAS `/journeys` ignores large `results` values — a single call returns
// only a handful of journeys clustered around the anchor (≈3–6 in practice),
// covering barely 20 minutes of departures. `fetchCandidates` therefore pages
// backward through `earlierRef` to span the whole visibility window; `results`
// just nudges each page slightly fuller.
const RESULTS_PER_REQUEST = 10;

// Safety cap on backward pagination. At ≈6 journeys/page this still reaches
// several hours back — far past any realistic visibility window — so hitting
// it means the feed is misbehaving, not that the window is genuinely large.
const MAX_PAGES = 12;

// ─── domain value objects ───────────────────────────────────────────────────

// A transit line (e.g. S5, U2, M10). Mirrors HAFAS line metadata down to the
// fields the pictogram and exclusion logic actually need.
export type Line = {
  name: string;
  product: string;
};

// One stop reference inside a leg. Lighter than the config-side `Stop` because
// we don't carry walking minutes here.
export type LegStop = {
  hafasStopId: string;
  displayName: string;
};

// One disruption / hint message attached to a leg by BVG. Severity is the
// HAFAS `type` string ("hint", "warning", "status", …) — kept as-is so the
// classifier can decide what's surfaceable without losing information.
export type Remark = {
  text: string;
  severity: string;
};

// Realtime metadata for one leg. Walking legs always carry an empty
// annotation (`hasRealtime: false`, `delaySeconds: 0`, no remarks). Transit
// legs carry whatever BVG returned: `delaySeconds` from `departureDelay`,
// `cancelled` from the leg's `cancelled` flag, `hasRealtime` from the
// presence of `prognosisType` (live data signal).
export type RealtimeAnnotation = {
  delaySeconds: number;
  cancelled: boolean;
  hasRealtime: boolean;
  remarks: readonly Remark[];
};

// A leg of a journey: either walking between two stops (or to/from an address)
// or riding a transit line.
export type WalkingLeg = {
  kind: "walking";
  origin: LegStop;
  destination: LegStop;
  departure: Date;
  arrival: Date;
  durationMinutes: number;
  realtime: RealtimeAnnotation;
};

export type TransitLeg = {
  kind: "transit";
  origin: LegStop;
  destination: LegStop;
  departure: Date;
  arrival: Date;
  line: Line;
  direction: string;
  realtime: RealtimeAnnotation;
};

export type Leg = WalkingLeg | TransitLeg;

const EMPTY_REALTIME: RealtimeAnnotation = {
  delaySeconds: 0,
  cancelled: false,
  hasRealtime: false,
  remarks: [],
};

// One BVG `/journeys` candidate, mapped into the domain.
export type Candidate = {
  legs: readonly Leg[];
  // Convenience: first leg's departure / last leg's arrival.
  departure: Date;
  arrival: Date;
};

export type FeedError = {
  kind: "feed-error";
  message: string;
};

// ─── HAFAS shape (only fields we read) ──────────────────────────────────────

type HafasStop = {
  id?: string;
  name?: string;
};

type HafasLine = {
  name?: string;
  product?: string;
};

type HafasRemark = {
  type?: string | null;
  text?: string | null;
  summary?: string | null;
};

type HafasLeg = {
  walking?: boolean;
  origin?: HafasStop;
  destination?: HafasStop;
  departure?: string | null;
  plannedDeparture?: string | null;
  departureDelay?: number | null;
  arrival?: string | null;
  plannedArrival?: string | null;
  arrivalDelay?: number | null;
  line?: HafasLine | null;
  direction?: string | null;
  distance?: number | null;
  cancelled?: boolean | null;
  prognosisType?: string | null;
  remarks?: HafasRemark[] | null;
};

type HafasJourney = {
  legs?: HafasLeg[];
};

type HafasJourneysResponse = {
  journeys?: HafasJourney[];
  // Opaque HAFAS cursor for the chronologically-preceding page. Passed back as
  // the `earlierThan` query param to walk the window backward.
  earlierRef?: string | null;
};

// ─── mapper ─────────────────────────────────────────────────────────────────

function toLegStop(s: HafasStop | undefined): LegStop {
  return {
    hafasStopId: s?.id ?? "",
    displayName: s?.name ?? "",
  };
}

function mapRemarks(raw: HafasRemark[] | null | undefined): readonly Remark[] {
  if (!raw || raw.length === 0) return [];
  const out: Remark[] = [];
  for (const r of raw) {
    const text = r.text ?? r.summary ?? "";
    if (!text) continue;
    out.push({ text, severity: r.type ?? "" });
  }
  return out;
}

function mapTransitRealtime(raw: HafasLeg): RealtimeAnnotation {
  // `prognosisType` is BVG's signal that live data is available (any non-null
  // value: "prognosed", "calculated", …). A non-zero `departureDelay` also
  // implies live data, even if `prognosisType` was elided.
  const delaySeconds = raw.departureDelay ?? 0;
  const hasRealtime = raw.prognosisType != null || raw.departureDelay != null;
  return {
    delaySeconds,
    cancelled: raw.cancelled === true,
    hasRealtime,
    remarks: mapRemarks(raw.remarks),
  };
}

function mapLeg(raw: HafasLeg): Leg | null {
  const departureIso = raw.departure ?? raw.plannedDeparture;
  const arrivalIso = raw.arrival ?? raw.plannedArrival;
  if (!departureIso || !arrivalIso) return null;
  const departure = new Date(departureIso);
  const arrival = new Date(arrivalIso);
  const origin = toLegStop(raw.origin);
  const destination = toLegStop(raw.destination);
  // A leg without a `line` is a walking transfer in HAFAS-speak. The explicit
  // `walking: true` flag is also set for those, but we tolerate either signal.
  if (raw.walking || !raw.line || !raw.line.name) {
    const durationMinutes = Math.max(
      0,
      Math.round((arrival.getTime() - departure.getTime()) / 60_000),
    );
    return {
      kind: "walking",
      origin,
      destination,
      departure,
      arrival,
      durationMinutes,
      realtime: EMPTY_REALTIME,
    };
  }
  return {
    kind: "transit",
    origin,
    destination,
    departure,
    arrival,
    line: { name: raw.line.name, product: raw.line.product ?? "" },
    direction: raw.direction ?? "",
    realtime: mapTransitRealtime(raw),
  };
}

function mapJourney(raw: HafasJourney): Candidate | null {
  const legs: Leg[] = [];
  for (const rawLeg of raw.legs ?? []) {
    const leg = mapLeg(rawLeg);
    if (!leg) return null;
    legs.push(leg);
  }
  if (legs.length === 0) return null;
  return {
    legs,
    departure: legs[0].departure,
    arrival: legs[legs.length - 1].arrival,
  };
}

// Public, pure mapper — exposed for fixture-driven testing. The fetch wrapper
// composes it with `fetch` below.
export function mapJourneysResponse(body: unknown): Candidate[] {
  const typed = body as HafasJourneysResponse;
  const out: Candidate[] = [];
  for (const j of typed.journeys ?? []) {
    const c = mapJourney(j);
    if (c) out.push(c);
  }
  return out;
}

// ─── client ─────────────────────────────────────────────────────────────────

export type FetchCandidates = (
  origin: Place,
  destination: Place,
  // Latest acceptable arrival instant (= window's `closesAt`). The first page
  // is anchored here; HAFAS returns journeys arriving *at or before* it, so
  // anchoring at the late-tail edge is what lets late-tail candidates surface.
  latestArrivalDate: Date,
  // Earliest departure still worth fetching (= the render's `now`). Backward
  // pagination stops once a page reaches journeys departing at or before this
  // — anything earlier is already uncatchable and gets dropped downstream.
  earliestDepartureDate: Date,
) => Promise<Candidate[] | FeedError>;

// One fetched-and-mapped page of `/journeys` results, plus the cursor for the
// page chronologically before it (`null` when HAFAS offers none).
export type JourneyPage = {
  candidates: Candidate[];
  earlierRef: string | null;
};

// Where a page is anchored: the first page pins an arrival instant, every
// later page rides an `earlierRef` handed back by its successor.
export type PageAnchor =
  | { kind: "arrival"; date: Date }
  | { kind: "earlier"; ref: string };

// Fetches a single page. Injected into `collectWindow` so the pagination walk
// is exercised without a live BVG endpoint.
export type FetchPage = (anchor: PageAnchor) => Promise<JourneyPage | FeedError>;

function isFeedError(v: JourneyPage | FeedError): v is FeedError {
  return "kind" in v;
}

// Pages backward from `latestArrivalDate` until a page reaches departures at or
// before `earliestDepartureDate`, HAFAS runs out of earlier pages, or
// `MAX_PAGES` is hit. A FeedError on the first page propagates; a FeedError on
// a later page returns whatever earlier pages already yielded, so a mid-walk
// hiccup still shows the late tail rather than a `feedUnreachable` screen.
export async function collectWindow(
  fetchPage: FetchPage,
  latestArrivalDate: Date,
  earliestDepartureDate: Date,
): Promise<Candidate[] | FeedError> {
  const collected: Candidate[] = [];
  // Pagination pages are non-overlapping by design, but a journey straddling a
  // page boundary can surface twice. First-leg departure + last-leg arrival
  // identifies a journey closely enough for the board's purposes.
  const seen = new Set<string>();
  let anchor: PageAnchor = { kind: "arrival", date: latestArrivalDate };

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(anchor);
    if (isFeedError(result)) {
      if (collected.length === 0) return result;
      break;
    }

    let pageEarliestDeparture = Infinity;
    for (const c of result.candidates) {
      pageEarliestDeparture = Math.min(pageEarliestDeparture, c.departure.getTime());
      const key = `${c.departure.toISOString()}|${c.arrival.toISOString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(c);
    }

    // Stop once this page reaches the render instant (it still includes the
    // straddling journeys departing just before it), or HAFAS offers no
    // earlier page, or the page came back empty.
    if (result.candidates.length === 0) break;
    if (pageEarliestDeparture <= earliestDepartureDate.getTime()) break;
    if (!result.earlierRef) break;
    anchor = { kind: "earlier", ref: result.earlierRef };
  }

  return collected;
}

// `from`/`to` accept either a HAFAS stop id (set as the bare `from`/`to` param)
// or a coordinate triple (`from.latitude`/`from.longitude`/`from.address`).
// BVG resolves the latter into a synthetic POI and prepends/appends a walking
// leg from the address to the nearest stop.
function appendPlaceParams(url: URL, prefix: "from" | "to", place: Place): void {
  if ("hafasStopId" in place) {
    url.searchParams.set(prefix, place.hafasStopId);
    return;
  }
  url.searchParams.set(`${prefix}.latitude`, String(place.latitude));
  url.searchParams.set(`${prefix}.longitude`, String(place.longitude));
  url.searchParams.set(`${prefix}.address`, place.address);
}

// Builds a `FetchPage` bound to one origin/destination pair and one wall-clock
// deadline shared across every page, so the whole paginated walk still honours
// `FETCH_TIMEOUT_MS` end-to-end. Network or parse failures produce a
// `FeedError` so callers can render `feedUnreachable` without seeing exceptions.
function hafasFetchPage(
  origin: Place,
  destination: Place,
  deadline: number,
): FetchPage {
  return async (anchor) => {
    const url = new URL(BVG_JOURNEYS_URL);
    appendPlaceParams(url, "from", origin);
    appendPlaceParams(url, "to", destination);
    if (anchor.kind === "arrival") {
      url.searchParams.set("arrival", anchor.date.toISOString());
    } else {
      url.searchParams.set("earlierThan", anchor.ref);
    }
    url.searchParams.set("results", String(RESULTS_PER_REQUEST));
    url.searchParams.set("language", "en");

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { kind: "feed-error", message: `timeout after ${FETCH_TIMEOUT_MS}ms` };
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(remainingMs) });
      if (!r.ok) {
        return { kind: "feed-error", message: `HTTP ${r.status}` };
      }
      const body = await r.json() as HafasJourneysResponse;
      return {
        candidates: mapJourneysResponse(body),
        earlierRef: body.earlierRef ?? null,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        return { kind: "feed-error", message: `timeout after ${FETCH_TIMEOUT_MS}ms` };
      }
      return {
        kind: "feed-error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

// Default implementation: page backward through BVG's `/journeys` from the
// window's late edge until the walk reaches the render instant.
export const fetchCandidates: FetchCandidates = (
  origin,
  destination,
  latestArrivalDate,
  earliestDepartureDate,
) => {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  return collectWindow(
    hafasFetchPage(origin, destination, deadline),
    latestArrivalDate,
    earliestDepartureDate,
  );
};
