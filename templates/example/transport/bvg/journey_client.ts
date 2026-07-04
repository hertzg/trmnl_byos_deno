// BvgJourneyClient — anti-corruption layer over BVG's HAFAS backend.
//
// Talks to HAFAS directly via `hafas-client` (bvg profile) — not the community
// REST mirror at v6.bvg.transport.rest, whose shared server proved unreliable
// (derhuerst/bvg-rest#30). The mirror was a thin serializer over hafas-client,
// so the parsed journeys carry the same HAFAS shape the mirror used to emit
// and the mapper below is unchanged.
//
// Maps that HAFAS shape into the journey board's domain value objects:
// `Candidate`, `Leg`, `Line`, `RealtimeAnnotation`. Walking-leg vs transit-leg
// discrimination is decided here, so the rest of the pipeline only ever sees
// clean discriminated unions.

import type { Place } from "./preference.ts";

// Hard ceiling on one whole journeys fetch (all pages). The board's refresh
// cadence is in the 30–300s range (see DEFAULTS), so anything slower than
// ~10s would already be on track to miss the next refresh — fail fast and let
// the pipeline render `feedUnreachable` instead of holding the request open.
const FETCH_TIMEOUT_MS = 10_000;

// HAFAS `/journeys` ignores large `results` values — a single call returns
// only a handful of journeys clustered around the anchor (≈3–6 in practice),
// covering barely 20 minutes of departures. `fetchCandidates` therefore pages
// backward through `earlierRef` to span the whole visibility window; `results`
// just nudges each page slightly fuller.
const RESULTS_PER_REQUEST = 10;

// Safety cap on backward pagination. At ≈3–6 journeys/page this still reaches
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
// presence of `departurePrognosisType` (hafas-client's live-data signal; see
// `mapTransitRealtime` for the tolerated legacy spellings).
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
  // HAFAS's stable per-journey identity. Used to dedup a journey that
  // surfaces on two adjacent pages even if its realtime times shifted
  // between the fetches. Absent on candidates not sourced from HAFAS
  // (e.g. test fixtures) — dedup falls back to departure+arrival then.
  refreshToken?: string;
};

export type FeedError = {
  kind: "feed-error";
  message: string;
};

// A pagination walk that ended before covering the whole window — a later
// page failed or the MAX_PAGES cap was hit — so `candidates` holds only the
// late-tail pages that did arrive. Distinct from a plain `Candidate[]` so
// callers can't mistake a truncated window for a complete one (the board
// assembler's keep-last-good cache must merge it, not be clobbered by it).
export type PartialWindow = {
  kind: "partial-window";
  candidates: Candidate[];
};

// Dedup key for one candidate: HAFAS's stable per-journey `refreshToken`
// when present (it survives realtime time shifts between fetches), else
// first-leg departure + last-leg arrival. Shared by `collectWindow`'s
// cross-page dedup and the board assembler's partial-window merge.
export function candidateKey(c: Candidate): string {
  return c.refreshToken ?? `${c.departure.toISOString()}|${c.arrival.toISOString()}`;
}

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
  departurePrognosisType?: string | null;
  remarks?: HafasRemark[] | null;
};

type HafasJourney = {
  legs?: HafasLeg[];
  // HAFAS's stable per-journey identity, opaque to us. Carried onto the
  // mapped `Candidate` so cross-page dedup survives realtime time shifts.
  refreshToken?: string | null;
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
  // `departurePrognosisType` is BVG's signal that live data backs the
  // departure time (any non-null value: "prognosed", "calculated", …). A
  // non-null `departureDelay` also implies live data, even if the prognosis
  // type was elided. `prognosisType` is the pre-hafas-client field name,
  // still tolerated so captured fixtures keep working.
  const delaySeconds = raw.departureDelay ?? 0;
  const hasRealtime = raw.prognosisType != null ||
    raw.departurePrognosisType != null ||
    raw.departureDelay != null;
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
    refreshToken: raw.refreshToken ?? undefined,
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
) => Promise<Candidate[] | PartialWindow | FeedError>;

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
// a later page (and the `MAX_PAGES` cap) returns whatever earlier pages
// already yielded, marked as a `PartialWindow` — a mid-walk hiccup still
// shows the late tail rather than a `feedUnreachable` screen, without passing
// the truncated window off as a complete one.
export async function collectWindow(
  fetchPage: FetchPage,
  latestArrivalDate: Date,
  earliestDepartureDate: Date,
): Promise<Candidate[] | PartialWindow | FeedError> {
  const collected: Candidate[] = [];
  // Pagination pages are non-overlapping by design, but a journey straddling a
  // page boundary can surface twice. `candidateKey` prefers HAFAS's stable
  // `refreshToken` identity, falling back to departure+arrival for candidates
  // without one (e.g. test fixtures).
  const seen = new Set<string>();
  let anchor: PageAnchor = { kind: "arrival", date: latestArrivalDate };

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(anchor);
    if (isFeedError(result)) {
      if (collected.length === 0) return result;
      return { kind: "partial-window", candidates: collected };
    }

    let pageEarliestDeparture = Infinity;
    for (const c of result.candidates) {
      pageEarliestDeparture = Math.min(pageEarliestDeparture, c.departure.getTime());
      const key = candidateKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(c);
    }

    // Complete once this page reaches the render instant (it still includes
    // the straddling journeys departing just before it), or HAFAS offers no
    // earlier page, or the page came back empty.
    if (result.candidates.length === 0) return collected;
    if (pageEarliestDeparture <= earliestDepartureDate.getTime()) return collected;
    if (!result.earlierRef) return collected;
    anchor = { kind: "earlier", ref: result.earlierRef };
  }

  // Cap exhausted without reaching the render instant — the feed is
  // misbehaving (see MAX_PAGES) and the window's early part is missing, so
  // this is a truncation like a mid-walk failure, not a complete window.
  return { kind: "partial-window", candidates: collected };
}

// `journeys()` accepts either a bare HAFAS stop id string or an FPTF
// `location` object (see hafas-client's docs/journeys.md). The address form
// makes BVG resolve the coordinates and prepend/append a walking leg between
// the address and the nearest stop.
function toHafasLocation(place: Place): string | Record<string, unknown> {
  if ("hafasStopId" in place) return place.hafasStopId;
  return {
    type: "location",
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

// hafas-client ships no TypeScript typings; this declares the one method we
// call. `journeys()` resolves to the same HAFAS shape the mapper consumes.
type HafasClient = {
  journeys(
    from: string | Record<string, unknown>,
    to: string | Record<string, unknown>,
    options: Record<string, unknown>,
  ): Promise<HafasJourneysResponse>;
};

// hafas-client (via its `debug` dependency) reads `process.env` during module
// evaluation, so a static import would make merely importing this file demand
// env permission — breaking permission-less `deno test` runs of the pure
// mapper and pagination tests. Import it lazily on the first real fetch
// instead, memoised for the module's lifetime. Constructing the client
// performs no I/O — the user-agent string just identifies this project to
// BVG on each request.
let clientPromise: Promise<HafasClient> | undefined;

function getClient(): Promise<HafasClient> {
  clientPromise ??= Promise.all([
    import("hafas-client"),
    import("hafas-client/p/bvg/index.js"),
  ]).then(([{ createClient }, { profile }]) =>
    createClient(
      profile,
      "trmnl-byos-deno (https://github.com/hertzg/trmnl-byos-deno)",
    )
  );
  return clientPromise;
}

// Races a hafas-client call against the shared wall-clock deadline.
// hafas-client has no AbortSignal support, so on timeout the losing
// `journeys()` call is left to settle on its own — its eventual rejection is
// pre-swallowed below so it can't surface as an unhandled rejection long
// after the page already failed.
function withDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  // `ReturnType<typeof setTimeout>` rather than `number`: pulling in the npm
  // dep brings Node's typings into scope, where setTimeout returns a Timeout.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout after ${FETCH_TIMEOUT_MS}ms`)),
      remainingMs,
    );
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Builds a `FetchPage` bound to one origin/destination pair and one wall-clock
// deadline shared across every page, so the whole paginated walk still honours
// `FETCH_TIMEOUT_MS` end-to-end. Network or HAFAS failures produce a
// `FeedError` so callers can render `feedUnreachable` without seeing exceptions.
function hafasFetchPage(
  origin: Place,
  destination: Place,
  deadline: number,
): FetchPage {
  const from = toHafasLocation(origin);
  const to = toHafasLocation(destination);
  return async (anchor) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { kind: "feed-error", message: `timeout after ${FETCH_TIMEOUT_MS}ms` };
    }
    const options = anchor.kind === "arrival"
      ? { arrival: anchor.date, results: RESULTS_PER_REQUEST, language: "en" }
      : { earlierThan: anchor.ref, results: RESULTS_PER_REQUEST, language: "en" };
    try {
      const client = await getClient();
      const body = await withDeadline(
        client.journeys(from, to, options),
        remainingMs,
      );
      return {
        candidates: mapJourneysResponse(body),
        earlierRef: body.earlierRef ?? null,
      };
    } catch (err) {
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
