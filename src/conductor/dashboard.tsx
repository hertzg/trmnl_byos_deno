/** @jsxImportSource hono/jsx */

// Dashboard at /. ADR-0005: a Plugin-debugging surface, not just a preview.
// The `t` scrubber drives the Conductor at arbitrary moments (past, present,
// future — Plugin.run is a pure function of ctx) and renders what the Plugin
// produced, side-by-side with what the Device is currently being served. The
// committed-vs-current diff and the rendered state make two silent Plugin
// bugs visible (docs/plugin-authoring.md):
//   - a view that reads wall-clock looks identical at every scrub position
//     even though `state` is identical
//   - a Plugin that computes `validity` against wall-clock has an `expiresAt`
//     that doesn't slide with `t`

import type { Result } from "../plugin/plugin.ts";

export type DashboardProps = {
  t: Temporal.ZonedDateTime;
  now: Temporal.ZonedDateTime;
  // What the Device is currently being served by /api/display. Null until
  // the first poll has populated Current Result + Current Image.
  committed: { t: Temporal.ZonedDateTime; result: Result<unknown>; identity: string } | null;
  // What the dashboard's scrub at `t` produced. Always present.
  current: { result: Result<unknown>; identity: string };
  pngBase64: string;
};

// `<input type="datetime-local">` exchanges values in "YYYY-MM-DDTHH:MM".
// The browser shows this in the user's locale; the server interprets it in
// its own timezone on submit (see GET / handler).
function toDatetimeLocal(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "minute" });
}

// Display time: drop timezone annotation and sub-second precision. The
// timezone is shown once in the page footer; everything renders in it.
function fmtTime(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ");
}

// "1d 3h", "5m 30s", "12s". Operator-readable; the underlying ISO string is
// already preserved on the datetime-local input and the URLs.
function fmtSeconds(totalSec: number): string {
  const t = Math.round(totalSec);
  if (t === 0) return "0s";
  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function fmtDuration(d: Temporal.Duration): string {
  return fmtSeconds(d.total({ unit: "seconds" }));
}

// Signed delta from `from` to `to`. "+30h59m from now", "27s ago", "now".
function fmtDelta(to: Temporal.ZonedDateTime, from: Temporal.ZonedDateTime): string {
  const cmp = Temporal.ZonedDateTime.compare(to, from);
  if (cmp === 0) return "now";
  const sec = Math.abs(to.since(from, { largestUnit: "hours" }).total({ unit: "seconds" }));
  const rounded = Math.round(sec);
  if (rounded === 0) return "now";
  return cmp > 0 ? `+${fmtSeconds(rounded)} from now` : `${fmtSeconds(rounded)} ago`;
}

function stepHref(t: Temporal.ZonedDateTime, by: Temporal.DurationLike): string {
  const next = t.add(by);
  return `/?t=${encodeURIComponent(toDatetimeLocal(next))}`;
}

// Quick-jump increments. Chosen to span the kinds of validity windows a Plugin
// typically uses — sub-minute (no, scrubber granularity is 1 minute), minutes
// for "departures every 5", hours for "photo of the day".
const STEPS: Array<{ label: string; by: Temporal.DurationLike }> = [
  { label: "+1m", by: { minutes: 1 } },
  { label: "+5m", by: { minutes: 5 } },
  { label: "+15m", by: { minutes: 15 } },
  { label: "+1h", by: { hours: 1 } },
  { label: "+6h", by: { hours: 6 } },
];

// Render Result.state as readable JSON. Replacer is defensive — `state` is
// the Plugin's data shape and should be JSON-friendly, but a hand-rolled
// Plugin might leak a function or a BigInt. Don't crash the debug page.
function stateJson(state: unknown): string {
  try {
    return JSON.stringify(
      state,
      (_k, v) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
        return v;
      },
      2,
    ) ?? "undefined";
  } catch (err) {
    return `(unserializable: ${(err as Error).message})`;
  }
}

const css = `
  html, body { margin: 0; padding: 0; background: #f4f4f4; color: #111; }
  body {
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    padding: 24px;
    max-width: 980px;
    margin: 0 auto;
  }
  h1 { margin: 0 0 16px; font-size: 20px; letter-spacing: -0.01em; }
  form { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  form label { font-size: 13px; color: #555; }
  form input[type="datetime-local"] {
    font: inherit; padding: 6px 8px; border: 1px solid #bbb; background: #fff;
  }
  form button { font: inherit; padding: 6px 12px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
  .steps { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; font-size: 13px; }
  .steps span { color: #555; }
  .steps a {
    padding: 4px 10px; border: 1px solid #bbb; background: #fff; color: #111;
    text-decoration: none; border-radius: 2px;
  }
  .steps a.commit { border-color: #111; }
  .steps a.reset { border-style: dashed; }
  .image-frame {
    background: #fff; border: 1px solid #ddd; padding: 12px;
    display: inline-block; margin-bottom: 16px;
  }
  .image-frame img { display: block; max-width: 100%; image-rendering: pixelated; }
  table.meta {
    border-collapse: collapse; width: 100%; font-size: 13px;
    background: #fff; border: 1px solid #ddd; margin-bottom: 16px;
  }
  table.meta th, table.meta td { padding: 6px 12px; text-align: left; vertical-align: top; }
  table.meta thead th {
    background: #fafafa; border-bottom: 1px solid #ddd;
    font-size: 12px; color: #555; font-weight: 500; text-transform: lowercase;
  }
  table.meta tbody th {
    width: max-content; color: #555; font-weight: normal; white-space: nowrap;
    border-right: 1px solid #eee;
  }
  table.meta tbody td { font-family: ui-monospace, "SF Mono", Menlo, monospace; width: 50%; }
  table.meta tbody td.diff { background: #fffbe6; }
  table.meta .rel { color: #888; font-family: inherit; font-size: 12px; }
  table.meta .muted { color: #888; font-family: inherit; font-style: italic; }
  p.head { margin: 8px 0 16px; font-size: 12px; color: #555; }
  p.head code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; }
  details.state { background: #fff; border: 1px solid #ddd; padding: 12px; }
  details.state summary { cursor: pointer; font-size: 13px; color: #555; }
  details.state pre {
    margin: 12px 0 0; font: 12px/1.4 ui-monospace, "SF Mono", Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
`;

function viewName(r: Result<unknown>): string {
  return r.view.name || "(anonymous)";
}

type Row = {
  label: string;
  committed: string | null; // null → no Current Result yet
  committedRel?: string | null;
  current: string;
  currentRel?: string | null;
};

export default function Dashboard(props: DashboardProps) {
  const { t, now, committed, current, pngBase64 } = props;
  const tCommit = committed?.t ?? null;

  const currentExpires = t.add(current.result.validity);
  const committedExpires = committed ? committed.t.add(committed.result.validity) : null;

  const rows: Row[] = [
    {
      label: "t",
      committed: committed ? fmtTime(committed.t) : null,
      committedRel: committed ? fmtDelta(committed.t, now) : null,
      current: fmtTime(t),
      currentRel: fmtDelta(t, now),
    },
    {
      label: "validity",
      committed: committed ? fmtDuration(committed.result.validity) : null,
      current: fmtDuration(current.result.validity),
    },
    {
      label: "expires",
      committed: committedExpires ? fmtTime(committedExpires) : null,
      committedRel: committed
        ? `+${fmtDuration(committed.result.validity)} past committed t`
        : null,
      current: fmtTime(currentExpires),
      currentRel: `+${fmtDuration(current.result.validity)} past chosen t`,
    },
    {
      label: "view",
      committed: committed ? viewName(committed.result) : null,
      current: viewName(current.result),
    },
    {
      label: "identity",
      committed: committed ? committed.identity : null,
      current: current.identity,
    },
  ];
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos dashboard</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <h1>dashboard — scrub Plugin time</h1>
        <form method="get" action="/">
          <label for="t">t</label>
          <input
            type="datetime-local"
            id="t"
            name="t"
            value={toDatetimeLocal(t)}
          />
          <button type="submit">scrub</button>
        </form>
        <div class="steps">
          <span>step:</span>
          {STEPS.map((s) => <a key={s.label} href={stepHref(t, s.by)}>{s.label}</a>)}
          {tCommit && (
            <a class="commit" href={`/?t=${encodeURIComponent(toDatetimeLocal(tCommit))}`}>
              current commit
            </a>
          )}
          <a class="reset" href="/">reset</a>
        </div>
        <div class="image-frame">
          <img src={`data:image/png;base64,${pngBase64}`} alt="Plugin output" />
        </div>
        <p class="head">
          now: <code>{fmtTime(now)}</code> · timezone: <code>{now.timeZoneId}</code>
        </p>
        <table class="meta">
          <thead>
            <tr>
              <th></th>
              <th>committed (Device sees this)</th>
              <th>current (chosen t)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const differs = row.committed !== null && row.committed !== row.current;
              const cls = differs ? "diff" : undefined;
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td class={cls}>
                    {row.committed === null
                      ? <span class="muted">(no Current Result yet)</span>
                      : (
                        <>
                          {row.committed}
                          {row.committedRel && (
                            <>
                              {" "}
                              <span class="rel">({row.committedRel})</span>
                            </>
                          )}
                        </>
                      )}
                  </td>
                  <td class={cls}>
                    {row.current}
                    {row.currentRel && (
                      <>
                        {" "}
                        <span class="rel">({row.currentRel})</span>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <details class="state" open>
          <summary>current Result.state (JSON)</summary>
          <pre>{stateJson(current.result.state)}</pre>
        </details>
      </body>
    </html>
  );
}
