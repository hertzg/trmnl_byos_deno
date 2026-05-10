/** @jsxImportSource hono/jsx */
import type { Board, Departure } from "./data.ts";
import Head from "./Head.tsx";
import LineBadge from "./LineBadge.tsx";
import LineGlyph from "./LineGlyph.tsx";
import WestList from "./WestList.tsx";
import { formatHHMM } from "./time.ts";

// Full-frame layout: two stacked hero cards on the left (immediate + backup), then a
// planning list of the remaining departures on the right. Two heroes give the user a
// trivial "if I miss the first, the second is my fallback" read without scanning the
// table.
const FULL_LIST_LIMIT = 8;

// Each hero is four rows:
//   1.  გადით:                       — label
//   2.  [glyph]  HH:MM                — leave-by, with the mode glyph next to it
//   3.  [badge]  → direction          — line code + headsign
//   4.  [platform] · გადის HH:MM      — platform + scheduled departure
function HeroCard({ dep }: { dep: Departure }) {
  return (
    <div class="hero">
      <div class="hero__time-row">
        <LineGlyph product={dep.product} size="xl" />
        <span class="hero__time">{formatHHMM(dep.leaveBy)}</span>
      </div>
      <div class="hero__line-row">
        <LineBadge line={dep.line} product={dep.product} size="lg" />
        <span class="hero__dir">→ {dep.direction}</span>
      </div>
      <div class="hero__dep">
        {dep.platform && (
          <>
            <span class="platform">ბაქანი {dep.platform}</span>
            {" · "}
          </>
        )}
        გადის {formatHHMM(dep.when)}
      </div>
    </div>
  );
}

export default function BVGFull(
  { board, fetchedAt }: { board: Board; fetchedAt: Date },
) {
  // Heroes are picked from the heroable subset only — `tableOnly` filters (FEX,
  // airport-bound regionals) are intentionally skipped here so they never become the
  // primary "leave by" prompt.
  const [first, second] = board.departures.filter((d) => !d.tableOnly);
  const heroes = new Set([first, second].filter(Boolean));

  // Reserve up to 2 slots for tableOnly entries. They're typically sparse (airport
  // regionals run a few times per day), so without a reservation they'd be pushed
  // off the bottom of the 8-row table by the dense S/U-Bahn departures and never
  // surface. The reserved entries still sort by leave-by — they're not pinned at
  // the bottom, just guaranteed a place at the table.
  const remaining = board.departures.filter((d) => !heroes.has(d));
  const tableOnlyRemaining = remaining.filter((d) => d.tableOnly);
  const regularRemaining = remaining.filter((d) => !d.tableOnly);
  const reserved = Math.min(tableOnlyRemaining.length, 2);
  const list = [
    ...regularRemaining.slice(0, FULL_LIST_LIMIT - reserved),
    ...tableOnlyRemaining.slice(0, reserved),
  ].sort((a, b) => a.when.localeCompare(b.when));

  return (
    <div class="slot slot--full">
      <Head
        title={`${board.title} · ${board.stop.name}`}
        stamp={`${board.stop.walkMin} წუთი ფეხით · განახლდა ${formatHHMM(fetchedAt)}`}
      />
      <div class="full-grid">
        <div class="hero-stack">
          {first && <HeroCard dep={first} />}
          {second && <HeroCard dep={second} />}
        </div>
        <div class="full-list">
          <div class="full-list__label">შემდეგ</div>
          <WestList departures={list} />
        </div>
      </div>
    </div>
  );
}
