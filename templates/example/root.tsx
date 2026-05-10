/** @jsxImportSource hono/jsx */
import type { FrameData } from "./data.ts";
import BVGTimetable from "./bvg/BVGTimetable.tsx";
import { formatHHMM } from "./bvg/time.ts";

const BERLIN_TZ = "Europe/Berlin";

function formatFetchedAt(now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export default function DefaultTemplate({ board, fetchedAt }: FrameData) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos-deno</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <BVGTimetable board={board} fetchedAt={fetchedAt} />
        <footer class="title-bar">
          <span class="title-bar__title">trmnl-byos-deno</span>
          <span class="title-bar__instance">
            BVG · {board.stop.name} · განახლდა {formatHHMM(fetchedAt)}
            {" · "}
            {formatFetchedAt(fetchedAt)}
          </span>
        </footer>
      </body>
    </html>
  );
}
