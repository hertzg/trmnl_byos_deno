import { assert, assertEquals } from "@std/assert";
import { mapJourneysResponse } from "./journey_client.ts";

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
