/** @jsxImportSource hono/jsx */

// Dashboard at /. A Plugin-debugging surface, not just a preview.
// The `t` scrubber runs the Plugin at an arbitrary moment and shows the
// resulting Image + Result metadata. A `view` that reads wall-clock looks
// identical at every scrub position even though `state` is identical; a
// `validity` computed against wall-clock has an `expiresAt` that doesn't
// slide with `t`. Both are silent under Device-only operation; the scrub
// view makes them visible.

import type { DeviceReport, Result } from "../plugin/plugin.ts";

export type DashboardProps = {
  t: Temporal.ZonedDateTime;
  // What the operator's `?t=` parsed to. Null when no `?t=` was supplied
  // (or parse failed). When non-null and different from the effective `t`
  // a notice is rendered — today the two only differ when parsing fails.
  tRequested: Temporal.ZonedDateTime | null;
  // Set when `?t=` was supplied but Temporal.PlainDateTime.from threw.
  parseError: string | null;
  now: Temporal.ZonedDateTime;
  // What the scrub at `t` produced. Always present.
  current: { result: Result<unknown>; identity: string; device: DeviceReport | null };
  // Flat per-step wall-clock collected via withTimings (from src/render/
  // timings.ts). Labels follow the convention "<group>.<step>" — the
  // dashboard splits by group into proportional bars. `totalMs` is the
  // dashboard handler's own wall-clock for the whole scrub call.
  timings: Record<string, number>;
  totalMs: number;
  // Null when the rasterize step failed. The page still renders — Result,
  // scrubber, and timings are useful debug surfaces without the image —
  // and `pngError` carries the failure message for an inline notice.
  pngBase64: string | null;
  pngError: string | null;
};

function toDatetimeLocal(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "minute" });
}

function fmtTime(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ");
}

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

const STEPS: Array<{ label: string; by: Temporal.DurationLike }> = [
  { label: "+1m", by: { minutes: 1 } },
  { label: "+5m", by: { minutes: 5 } },
  { label: "+15m", by: { minutes: 15 } },
  { label: "+1h", by: { hours: 1 } },
  { label: "+6h", by: { hours: 6 } },
];

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
  table.meta tbody th {
    width: max-content; color: #555; font-weight: normal; white-space: nowrap;
    border-right: 1px solid #eee;
  }
  table.meta tbody td { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  table.meta .rel { color: #888; font-family: inherit; font-size: 12px; }
  table.meta .muted { color: #888; font-family: inherit; font-style: italic; }
  p.head { margin: 8px 0 16px; font-size: 12px; color: #555; }
  p.head code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; }
  p.notice {
    margin: 0 0 16px; padding: 8px 12px; font-size: 13px;
    background: #fffbe6; border: 1px solid #f0c040; color: #663d00;
  }
  p.notice code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .timings-block {
    background: #fff; border: 1px solid #ddd; padding: 10px 12px;
    margin-bottom: 8px;
    font: 12px ui-monospace, "SF Mono", Menlo, monospace;
  }
  .timings-block .title {
    font-size: 11px; color: #888; text-transform: lowercase;
    margin-bottom: 6px; font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  }
  .timings-grid {
    display: grid; grid-template-columns: max-content 1fr max-content;
    gap: 2px 12px; align-items: center;
  }
  .timings-grid .row-label { color: #555; }
  .timings-grid .row-bar {
    height: 12px; background: #f0f0f0; min-width: 100px;
  }
  .timings-grid .row-bar > div {
    height: 100%; background: #64b5f6;
  }
  .timings-grid .row-bar.max > div { background: #1976d2; }
  .timings-grid .row-ms { color: #555; text-align: right; }
  p.timings-total { margin: 0 0 16px; font-size: 12px; color: #555; }
  p.timings-total code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; }
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

function deviceLabel(d: DeviceReport | null): string {
  return d?.id ?? "(none yet)";
}

function fmtMs(ms: number): string {
  if (ms < 0.5) return "<1ms";
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

type TimingEntry = { label: string; ms: number };

function TimingsBlock(props: { title: string; entries: TimingEntry[] }) {
  const max = Math.max(0.001, ...props.entries.map((e) => e.ms));
  return (
    <div class="timings-block">
      <div class="title">{props.title}</div>
      <div class="timings-grid">
        {props.entries.map((e) => {
          const pct = (e.ms / max) * 100;
          const isMax = e.ms === max;
          return [
            <div key={`${e.label}-l`} class="row-label">{e.label}</div>,
            <div key={`${e.label}-b`} class={`row-bar${isMax ? " max" : ""}`}>
              <div style={`width: ${pct}%;`} />
            </div>,
            <div key={`${e.label}-m`} class="row-ms">{fmtMs(e.ms)}</div>,
          ];
        })}
      </div>
    </div>
  );
}

function groupTimings(timings: Record<string, number>): Array<[string, TimingEntry[]]> {
  const groups = new Map<string, TimingEntry[]>();
  for (const [label, ms] of Object.entries(timings)) {
    const dot = label.indexOf(".");
    const group = dot === -1 ? "(other)" : label.slice(0, dot);
    const step = dot === -1 ? label : label.slice(dot + 1);
    const list = groups.get(group) ?? [];
    list.push({ label: step, ms });
    groups.set(group, list);
  }
  return [...groups.entries()];
}

export default function Dashboard(props: DashboardProps) {
  const { t, tRequested, parseError, now, current, timings, totalMs, pngBase64, pngError } = props;
  const groupedTimings = groupTimings(timings);
  const currentExpires = t.add(current.result.validity);

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
        {parseError && (
          <p class="notice">
            could not parse <code>?t=</code> — falling back to default.{" "}
            <span class="rel">({parseError})</span>
          </p>
        )}
        {tRequested && Temporal.ZonedDateTime.compare(tRequested, t) !== 0 && (
          <p class="notice">
            requested <code>{toDatetimeLocal(tRequested)}</code> — rendered at{" "}
            <code>{fmtTime(t)}</code>.
          </p>
        )}
        <div class="steps">
          <span>step:</span>
          {STEPS.map((s) => <a key={s.label} href={stepHref(t, s.by)}>{s.label}</a>)}
          <a class="reset" href="/">reset</a>
        </div>
        {pngBase64
          ? (
            <div class="image-frame">
              <img src={`data:image/png;base64,${pngBase64}`} alt="Plugin output" />
            </div>
          )
          : (
            <p class="notice">
              rasterize failed — page below still reflects the Plugin's run.
              {pngError && (
                <>
                  {" "}
                  <code>{pngError}</code>
                </>
              )}
            </p>
          )}
        <p class="head">
          now: <code>{fmtTime(now)}</code> · timezone: <code>{now.timeZoneId}</code>
        </p>
        <table class="meta">
          <tbody>
            <tr>
              <th scope="row">t</th>
              <td>
                {fmtTime(t)} <span class="rel">({fmtDelta(t, now)})</span>
              </td>
            </tr>
            <tr>
              <th scope="row">validity</th>
              <td>{fmtDuration(current.result.validity)}</td>
            </tr>
            <tr>
              <th scope="row">expires</th>
              <td>
                {fmtTime(currentExpires)}{" "}
                <span class="rel">(+{fmtDuration(current.result.validity)} past chosen t)</span>
              </td>
            </tr>
            <tr>
              <th scope="row">view</th>
              <td>{viewName(current.result)}</td>
            </tr>
            <tr>
              <th scope="row">identity</th>
              <td>{current.identity}</td>
            </tr>
            <tr>
              <th scope="row">device</th>
              <td>{deviceLabel(current.device)}</td>
            </tr>
          </tbody>
        </table>
        <details class="state" open>
          <summary>current Result.state (JSON)</summary>
          <pre>{stateJson(current.result.state)}</pre>
        </details>
        {groupedTimings.map(([group, entries]) => (
          <TimingsBlock key={group} title={group} entries={entries} />
        ))}
        <p class="timings-total">
          re-render: <code>{fmtMs(totalMs)}</code>
        </p>
      </body>
    </html>
  );
}
