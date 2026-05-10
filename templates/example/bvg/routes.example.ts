// Starter template for the gitignored `routes.ts`. Copy this file to `routes.ts` and
// edit it for your own commute:
//
//   cp templates/example/bvg/routes.example.ts templates/example/bvg/routes.ts
//
// Stop IDs come from BVG's HAFAS database. Look one up with:
//   curl 'https://v6.bvg.transport.rest/locations?query=<name>'
//
// One board describes one commute decision: a single from-stop with a walk time, plus
// the lines/directions that leave it. Departures from all matching filters are merged
// and sorted by departure time; the layout adds the `walkMin` walk to compute "leave
// by" deadlines.
//
// Filter shape:
//   { line }                          — any direction at the stop
//   { line, direction }               — substring/regex match against the destination
//   { direction }                     — any line going to a matching destination
//   { ..., tableOnly: true }          — show in the table but never promote to a hero
//
// First-match wins: if a departure matches multiple filters, the first one in the
// list decides whether it's table-only. Order more specific (heroable) filters
// before broader (tableOnly) catch-alls.
//
// Layouts:
//   "full"        — two stacked hero cards + planning list (whole frame)
//   "horizontal"  — six-card column flow (top/bottom strip)
//   "vertical"    — single list (left/right column)

import type { RoutesConfig } from "./data.ts";

// Demo: westbound S/U-Bahn from Berlin Hauptbahnhof, with FEX and any airport-bound
// regionals listed in the table only.
export const ROUTES: RoutesConfig = {
  title: "→ West",
  stop: {
    id: "900003201", // S+U Berlin Hauptbahnhof
    name: "Hauptbahnhof",
    walkMin: 8,
  },
  layout: "full",
  filters: [
    { line: "S5", direction: "Westkreuz" },
    { line: "S7", direction: "Potsdam" },
    { line: "U5" },
    // Airport options — useful to know about, never the commute decision.
    { line: "FEX", tableOnly: true },
    { direction: "Flughafen", tableOnly: true },
  ],
};
