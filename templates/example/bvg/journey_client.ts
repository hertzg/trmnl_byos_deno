// BvgJourneyClient — anti-corruption layer to https://v6.bvg.transport.rest/journeys.
//
// Maps the HAFAS-shaped JSON returned by the BVG REST mirror into the journey
// board's domain value objects: `Candidate`, `Leg`, `Line`. Walking-leg vs
// transit-leg discrimination is decided here, so the rest of the pipeline only
// ever sees clean discriminated unions.
//
// Slice 1 scope: shape mapping only. No realtime, no remarks, no cancellation.

const BVG_JOURNEYS_URL = "https://v6.bvg.transport.rest/journeys";

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

// A leg of a journey: either walking between two stops (or to/from an address)
// or riding a transit line.
export type WalkingLeg = {
  kind: "walking";
  origin: LegStop;
  destination: LegStop;
  departure: Date;
  arrival: Date;
  durationMinutes: number;
};

export type TransitLeg = {
  kind: "transit";
  origin: LegStop;
  destination: LegStop;
  departure: Date;
  arrival: Date;
  line: Line;
  direction: string;
};

export type Leg = WalkingLeg | TransitLeg;

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

type HafasLeg = {
  walking?: boolean;
  origin?: HafasStop;
  destination?: HafasStop;
  departure?: string | null;
  plannedDeparture?: string | null;
  arrival?: string | null;
  plannedArrival?: string | null;
  line?: HafasLine | null;
  direction?: string | null;
  distance?: number | null;
};

type HafasJourney = {
  legs?: HafasLeg[];
};

type HafasJourneysResponse = {
  journeys?: HafasJourney[];
};

// ─── mapper ─────────────────────────────────────────────────────────────────

function toLegStop(s: HafasStop | undefined): LegStop {
  return {
    hafasStopId: s?.id ?? "",
    displayName: s?.name ?? "",
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
  origin: { hafasStopId: string },
  destination: { hafasStopId: string },
  arriveByDate: Date,
) => Promise<Candidate[] | FeedError>;

// Default implementation: hit BVG's `/journeys` and map. Network or parse
// failures produce a `FeedError` so callers can render `feedUnreachable` in a
// later slice without seeing exceptions.
export const fetchCandidates: FetchCandidates = async (
  origin,
  destination,
  arriveByDate,
) => {
  const url = new URL(BVG_JOURNEYS_URL);
  url.searchParams.set("from", origin.hafasStopId);
  url.searchParams.set("to", destination.hafasStopId);
  url.searchParams.set("arrival", arriveByDate.toISOString());
  url.searchParams.set("language", "en");
  try {
    const r = await fetch(url);
    if (!r.ok) {
      return { kind: "feed-error", message: `HTTP ${r.status}` };
    }
    const body = await r.json();
    return mapJourneysResponse(body);
  } catch (err) {
    return {
      kind: "feed-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
};
