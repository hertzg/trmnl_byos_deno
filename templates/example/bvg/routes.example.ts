// Starter template for the gitignored `routes.ts`. Copy this file to `routes.ts` and
// replace the stops/filters with the lines you actually care about:
//
//   cp templates/example/bvg/routes.example.ts templates/example/bvg/routes.ts
//
// Stop IDs come from BVG's HAFAS database. Look one up with:
//   curl 'https://v6.bvg.transport.rest/locations?query=<name>'
//
// Filter shape:
//   { line }                    — any direction at any included stop
//   { line, stops }             — restrict the line to specific stop IDs
//   { line, direction }         — substring/regex match against the destination text
//   { line, direction, stops }  — all three combined

import type { RoutesConfig } from "./data.ts";

// Demo config: Berlin Mitte. Hauptbahnhof and Alexanderplatz are two of the city's
// busiest interchanges, so the demo always has plenty of varied data to render.
export const ROUTES: RoutesConfig = {
  stops: [
    "900003201", // S+U Berlin Hauptbahnhof
    "900100003", // S+U Alexanderplatz Bhf
  ],
  filters: [
    // S-Bahn line, both directions, at every included stop.
    { line: "S7" },
    // U-Bahn line scoped to one stop (U5's western terminus is Hauptbahnhof).
    { line: "U5", stops: ["900003201"] },
    // Tram line filtered to a specific destination — `direction` is a substring/regex.
    { line: "M4", direction: "Hackescher Markt" },
    // Airport express, both directions, at every included stop.
    { line: "FEX" },
    // Night bus only shown at Alexanderplatz.
    { line: "N40", stops: ["900100003"] },
  ],
};
