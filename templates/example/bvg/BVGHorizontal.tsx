/** @jsxImportSource hono/jsx */
import type { Board, Departure } from "./data.ts";
import Head from "./Head.tsx";
import LineTag from "./LineTag.tsx";
import { formatHHMM } from "./time.ts";

// Six cards across the 1776 × 600 horizontal slot. The first is the lead — heavier
// rule and oversized leave-by — so the eye lands on it before scanning right.
const HORIZONTAL_LIMIT = 6;

function HCard({ dep, lead }: { dep: Departure; lead: boolean }) {
  return (
    <div class={lead ? "h-card h-card--lead" : "h-card"}>
      <div class="h-card__label">{lead ? "შემდეგი · გადით" : "შემდეგ"}</div>
      <div class="h-card__leave">{formatHHMM(dep.leaveBy)}</div>
      <div class="h-card__line">
        <LineTag
          line={dep.line}
          product={dep.product}
          size={lead ? "lg" : "md"}
        />
      </div>
      <div class="h-card__dir">→ {dep.direction}</div>
      <div class="h-card__dep">
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

export default function BVGHorizontal(
  { board, fetchedAt }: { board: Board; fetchedAt: Date },
) {
  const cards = board.departures.slice(0, HORIZONTAL_LIMIT);
  return (
    <div class="slot slot--horizontal">
      <Head
        title={`${board.title} · ${board.stop.name} · ${board.stop.walkMin} წუთი ფეხით`}
        stamp={`განახლდა ${formatHHMM(fetchedAt)}`}
      />
      <div class="h-flow">
        {cards.map((d, i) => (
          <HCard key={`${d.line}|${d.direction}|${d.when}`} dep={d} lead={i === 0} />
        ))}
      </div>
    </div>
  );
}
