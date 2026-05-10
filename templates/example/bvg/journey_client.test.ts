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
