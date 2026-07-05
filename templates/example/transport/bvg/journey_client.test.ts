import { assert, assertEquals } from "@std/assert";
import { collectWindow, mapJourneysResponse } from "./journey_client.ts";
import type { Candidate, FeedError, FetchPage, JourneyPage, PageAnchor } from "./journey_client.ts";

// Minimal HAFAS journeys fixture: one journey with one transit leg (S5).
// Captured shape from https://v6.bvg.transport.rest/journeys
const FIXTURE_SINGLE_TRANSIT_LEG = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          tripId: "1|123|0|80|10112025",
          origin: {
            type: "stop",
            id: "900003201",
            name: "Berlin Hauptbahnhof",
          },
          destination: {
            type: "stop",
            id: "900100003",
            name: "Berlin Alexanderplatz",
          },
          departure: "2025-11-10T08:00:00+01:00",
          plannedDeparture: "2025-11-10T08:00:00+01:00",
          arrival: "2025-11-10T08:12:00+01:00",
          plannedArrival: "2025-11-10T08:12:00+01:00",
          line: {
            type: "line",
            name: "S5",
            product: "suburban",
          },
          direction: "Strausberg",
        },
      ],
    },
  ],
};

// Mixed walk → ride → walk journey — exercises the kind discrimination on
// every position (lead walk, transit, trailing walk).
const FIXTURE_WALK_RIDE_WALK = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          walking: true,
          distance: 320,
          origin: { type: "location", name: "Home" },
          destination: { type: "stop", id: "900003201", name: "Hbf" },
          departure: "2025-11-10T07:52:00+01:00",
          arrival: "2025-11-10T08:00:00+01:00",
        },
        {
          tripId: "1|123|0|80|10112025",
          origin: { type: "stop", id: "900003201", name: "Hbf" },
          destination: { type: "stop", id: "900100003", name: "Alex" },
          departure: "2025-11-10T08:00:00+01:00",
          arrival: "2025-11-10T08:12:00+01:00",
          line: { type: "line", name: "S5", product: "suburban" },
          direction: "Strausberg",
        },
        {
          walking: true,
          distance: 180,
          origin: { type: "stop", id: "900100003", name: "Alex" },
          destination: { type: "location", name: "Office" },
          departure: "2025-11-10T08:12:00+01:00",
          arrival: "2025-11-10T08:16:00+01:00",
        },
      ],
    },
  ],
};

Deno.test("mapJourneysResponse discriminates walking and transit legs", () => {
  const [c] = mapJourneysResponse(FIXTURE_WALK_RIDE_WALK);
  assertEquals(c.legs.length, 3);
  assertEquals(c.legs[0].kind, "walking");
  assertEquals(c.legs[1].kind, "transit");
  assertEquals(c.legs[2].kind, "walking");
  if (c.legs[0].kind === "walking") {
    assertEquals(c.legs[0].durationMinutes, 8);
  }
});

Deno.test("mapJourneysResponse maps a single-transit-leg journey", () => {
  const candidates = mapJourneysResponse(FIXTURE_SINGLE_TRANSIT_LEG);
  assertEquals(candidates.length, 1);
  const c = candidates[0];
  assertEquals(c.legs.length, 1);
  const leg = c.legs[0];
  assert(leg.kind === "transit", "expected transit leg");
  assertEquals(leg.line.name, "S5");
  assertEquals(leg.line.product, "suburban");
  assertEquals(leg.origin.displayName, "Berlin Hauptbahnhof");
  assertEquals(leg.destination.displayName, "Berlin Alexanderplatz");
  assertEquals(leg.departure.toISOString(), "2025-11-10T07:00:00.000Z");
  assertEquals(leg.arrival.toISOString(), "2025-11-10T07:12:00.000Z");
  assertEquals(c.departure.toISOString(), "2025-11-10T07:00:00.000Z");
  assertEquals(c.arrival.toISOString(), "2025-11-10T07:12:00.000Z");
});

// ─── slice 6: realtime annotation ───────────────────────────────────────────

// On-time leg: planned == actual departure, prognosisType present (live data),
// no remarks. delaySeconds == 0 but hasRealtime == true.
const FIXTURE_ON_TIME_REALTIME = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          tripId: "1|on-time",
          origin: { type: "stop", id: "900003201", name: "Hbf" },
          destination: { type: "stop", id: "900100003", name: "Alex" },
          departure: "2025-11-10T08:00:00+01:00",
          plannedDeparture: "2025-11-10T08:00:00+01:00",
          departureDelay: 0,
          arrival: "2025-11-10T08:12:00+01:00",
          plannedArrival: "2025-11-10T08:12:00+01:00",
          arrivalDelay: 0,
          prognosisType: "prognosed",
          line: { type: "line", name: "S5", product: "suburban" },
          direction: "Strausberg",
        },
      ],
    },
  ],
};

// Delayed leg: BVG sends `departureDelay` in seconds. Real departure differs
// from `plannedDeparture` accordingly.
const FIXTURE_DELAYED = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          tripId: "1|delayed",
          origin: { type: "stop", id: "900003201", name: "Hbf" },
          destination: { type: "stop", id: "900100003", name: "Alex" },
          departure: "2025-11-10T08:04:00+01:00",
          plannedDeparture: "2025-11-10T08:00:00+01:00",
          departureDelay: 240,
          arrival: "2025-11-10T08:16:00+01:00",
          plannedArrival: "2025-11-10T08:12:00+01:00",
          arrivalDelay: 240,
          prognosisType: "prognosed",
          line: { type: "line", name: "S5", product: "suburban" },
          direction: "Strausberg",
        },
      ],
    },
  ],
};

// Leg carrying disruption remarks. Severity strings come straight from BVG.
const FIXTURE_REMARKS = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          tripId: "1|remarks",
          origin: { type: "stop", id: "900003201", name: "Hbf" },
          destination: { type: "stop", id: "900100003", name: "Alex" },
          departure: "2025-11-10T08:00:00+01:00",
          plannedDeparture: "2025-11-10T08:00:00+01:00",
          arrival: "2025-11-10T08:12:00+01:00",
          plannedArrival: "2025-11-10T08:12:00+01:00",
          line: { type: "line", name: "U2", product: "subway" },
          direction: "Pankow",
          remarks: [
            {
              type: "hint",
              code: "text.realtime",
              text: "Lift OOS at Alex",
              summary: "Lift OOS",
            },
            {
              type: "warning",
              summary: "Construction works",
              text: "Construction works between A and B",
              priority: 100,
            },
          ],
        },
      ],
    },
  ],
};

Deno.test("mapJourneysResponse extracts realtime annotation on on-time transit leg", () => {
  const [c] = mapJourneysResponse(FIXTURE_ON_TIME_REALTIME);
  const leg = c.legs[0];
  assert(leg.kind === "transit");
  assertEquals(leg.realtime.delaySeconds, 0);
  assertEquals(leg.realtime.cancelled, false);
  assertEquals(leg.realtime.hasRealtime, true);
  assertEquals(leg.realtime.remarks, []);
});

// hafas-client emits `departurePrognosisType` (the REST mirror era's field
// was `prognosisType`) — the mapper must accept it as the live-data signal
// on its own, without a delay or the legacy spelling alongside.
const FIXTURE_DEPARTURE_PROGNOSIS_ONLY = {
  journeys: [
    {
      type: "journey",
      legs: [
        {
          tripId: "1|departure-prognosis",
          origin: { type: "stop", id: "900003201", name: "Hbf" },
          destination: { type: "stop", id: "900100003", name: "Alex" },
          departure: "2025-11-10T08:00:00+01:00",
          plannedDeparture: "2025-11-10T08:00:00+01:00",
          arrival: "2025-11-10T08:12:00+01:00",
          plannedArrival: "2025-11-10T08:12:00+01:00",
          departurePrognosisType: "prognosed",
          line: { type: "line", name: "S5", product: "suburban" },
          direction: "Strausberg",
        },
      ],
    },
  ],
};

Deno.test("mapJourneysResponse: departurePrognosisType alone marks hasRealtime", () => {
  const [c] = mapJourneysResponse(FIXTURE_DEPARTURE_PROGNOSIS_ONLY);
  const leg = c.legs[0];
  assert(leg.kind === "transit");
  assertEquals(leg.realtime.hasRealtime, true);
  assertEquals(leg.realtime.delaySeconds, 0);
  assertEquals(leg.realtime.cancelled, false);
});

Deno.test("mapJourneysResponse: leg without prognosisType has hasRealtime=false", () => {
  // FIXTURE_SINGLE_TRANSIT_LEG has no prognosisType, no departureDelay.
  const [c] = mapJourneysResponse(FIXTURE_SINGLE_TRANSIT_LEG);
  const leg = c.legs[0];
  assert(leg.kind === "transit");
  assertEquals(leg.realtime.delaySeconds, 0);
  assertEquals(leg.realtime.hasRealtime, false);
});

Deno.test("mapJourneysResponse extracts delaySeconds from a delayed leg", () => {
  const [c] = mapJourneysResponse(FIXTURE_DELAYED);
  const leg = c.legs[0];
  assert(leg.kind === "transit");
  assertEquals(leg.realtime.delaySeconds, 240);
  assertEquals(leg.realtime.hasRealtime, true);
  assertEquals(leg.realtime.cancelled, false);
});

Deno.test("mapJourneysResponse maps remarks with severity from HAFAS 'type'", () => {
  const [c] = mapJourneysResponse(FIXTURE_REMARKS);
  const leg = c.legs[0];
  assert(leg.kind === "transit");
  assertEquals(leg.realtime.remarks.length, 2);
  assertEquals(leg.realtime.remarks[0].text, "Lift OOS at Alex");
  assertEquals(leg.realtime.remarks[0].severity, "hint");
  assertEquals(leg.realtime.remarks[1].text, "Construction works between A and B");
  assertEquals(leg.realtime.remarks[1].severity, "warning");
});

Deno.test("mapJourneysResponse: walking leg carries an empty realtime annotation", () => {
  const [c] = mapJourneysResponse(FIXTURE_WALK_RIDE_WALK);
  const walk = c.legs[0];
  assert(walk.kind === "walking");
  assertEquals(walk.realtime.delaySeconds, 0);
  assertEquals(walk.realtime.cancelled, false);
  assertEquals(walk.realtime.hasRealtime, false);
  assertEquals(walk.realtime.remarks, []);
});

// ─── backward pagination: collectWindow ─────────────────────────────────────
//
// A single HAFAS `/journeys` call returns only ~6 journeys clustered before
// the anchor, so `collectWindow` pages backward through `earlierRef` to span
// the whole visibility window. These tests drive that walk with a scripted
// `FetchPage` — no network.

// `collectWindow` only reads `departure` / `arrival` / `refreshToken`; an empty
// leg list keeps these fixtures focused on the pagination walk itself.
// `refreshToken` is optional — omit it to exercise the departure+arrival
// fallback dedup key, pass it to exercise the stable-identity dedup key.
function candidate(
  departureIso: string,
  arrivalIso: string,
  refreshToken?: string,
): Candidate {
  return {
    legs: [],
    departure: new Date(departureIso),
    arrival: new Date(arrivalIso),
    refreshToken,
  };
}

function page(earlierRef: string | null, ...candidates: Candidate[]): JourneyPage {
  return { candidates, earlierRef };
}

// A `FetchPage` that replays a scripted list of pages (clamping to the last
// one once exhausted) and records the anchor it was asked for each call.
function scriptedPages(
  pages: readonly (JourneyPage | FeedError)[],
): { fetchPage: FetchPage; anchors: PageAnchor[] } {
  const anchors: PageAnchor[] = [];
  let next = 0;
  const fetchPage: FetchPage = (anchor) => {
    anchors.push(anchor);
    const p = pages[Math.min(next, pages.length - 1)];
    next++;
    return Promise.resolve(p);
  };
  return { fetchPage, anchors };
}

const NOW = new Date("2026-05-25T07:00:00+02:00");
const CLOSES_AT = new Date("2026-05-25T09:30:00+02:00");

Deno.test("collectWindow pages backward until a page reaches the render instant", async () => {
  const { fetchPage, anchors } = scriptedPages([
    page("ref-1", candidate("2026-05-25T08:30:00+02:00", "2026-05-25T09:25:00+02:00")),
    page("ref-2", candidate("2026-05-25T07:50:00+02:00", "2026-05-25T08:40:00+02:00")),
    page("ref-3", candidate("2026-05-25T06:55:00+02:00", "2026-05-25T07:45:00+02:00")),
    page("ref-4", candidate("2026-05-25T06:00:00+02:00", "2026-05-25T06:50:00+02:00")),
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assert(Array.isArray(result));
  // Stopped after the page whose earliest departure (06:55) crossed NOW — the
  // 06:00 page is never fetched.
  assertEquals(result.length, 3);
  assertEquals(anchors, [
    { kind: "arrival", date: CLOSES_AT },
    { kind: "earlier", ref: "ref-1" },
    { kind: "earlier", ref: "ref-2" },
  ]);
});

Deno.test("collectWindow stops when HAFAS offers no earlier page", async () => {
  const { fetchPage, anchors } = scriptedPages([
    page(null, candidate("2026-05-25T08:30:00+02:00", "2026-05-25T09:25:00+02:00")),
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assert(Array.isArray(result));
  assertEquals(result.length, 1);
  assertEquals(anchors.length, 1);
});

Deno.test("collectWindow stops at the MAX_PAGES pagination cap and reports a partial window", async () => {
  // Every page reports a late departure and another earlier page, so only the
  // hard cap can end the walk — which means the window's early part was never
  // reached, so the result must be marked partial.
  const { fetchPage, anchors } = scriptedPages([
    page("loop", candidate("2026-05-25T09:00:00+02:00", "2026-05-25T09:25:00+02:00")),
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assertEquals(anchors.length, 12); // MAX_PAGES
  assert(!Array.isArray(result));
  assertEquals(result.kind, "partial-window");
});

Deno.test("collectWindow propagates a FeedError on the first page", async () => {
  const err: FeedError = { kind: "feed-error", message: "HTTP 503" };
  const { fetchPage } = scriptedPages([err]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assert(!Array.isArray(result));
  assert(result.kind === "feed-error");
  assertEquals(result.message, "HTTP 503");
});

Deno.test("collectWindow keeps earlier pages as a partial window when a later page fails", async () => {
  const { fetchPage } = scriptedPages([
    page("ref-1", candidate("2026-05-25T08:30:00+02:00", "2026-05-25T09:25:00+02:00")),
    { kind: "feed-error", message: "timeout" },
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  // The late tail survives, but marked partial — callers must not mistake it
  // for a complete window.
  assert(!Array.isArray(result));
  assert(result.kind === "partial-window");
  assertEquals(result.candidates.length, 1);
});

// These fixtures carry no `refreshToken`, so this exercises the
// departure+arrival fallback dedup key.
Deno.test("collectWindow dedupes a journey that straddles a page boundary", async () => {
  const shared = candidate("2026-05-25T08:00:00+02:00", "2026-05-25T08:50:00+02:00");
  const { fetchPage } = scriptedPages([
    page(
      "ref-1",
      candidate("2026-05-25T08:30:00+02:00", "2026-05-25T09:25:00+02:00"),
      shared,
    ),
    page(null, shared, candidate("2026-05-25T06:55:00+02:00", "2026-05-25T07:40:00+02:00")),
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assert(Array.isArray(result));
  assertEquals(result.length, 3); // the shared journey is counted once
});

Deno.test("collectWindow dedupes by refreshToken when realtime times shift across pages", async () => {
  // Same journey on two adjacent pages, but its realtime-adjusted departure
  // shifted between the two `/journeys` fetches (a delay landed). The
  // departure+arrival key would differ; `refreshToken` still collapses them.
  const onPage1 = candidate(
    "2026-05-25T08:00:00+02:00",
    "2026-05-25T08:50:00+02:00",
    "T$journey-42",
  );
  const onPage2 = candidate(
    "2026-05-25T08:03:00+02:00",
    "2026-05-25T08:53:00+02:00",
    "T$journey-42",
  );
  const { fetchPage } = scriptedPages([
    page(
      "ref-1",
      candidate("2026-05-25T08:30:00+02:00", "2026-05-25T09:25:00+02:00"),
      onPage1,
    ),
    page(null, onPage2, candidate("2026-05-25T06:55:00+02:00", "2026-05-25T07:40:00+02:00")),
  ]);
  const result = await collectWindow(fetchPage, CLOSES_AT, NOW);
  assert(Array.isArray(result));
  assertEquals(result.length, 3); // the shared journey is counted once
});
