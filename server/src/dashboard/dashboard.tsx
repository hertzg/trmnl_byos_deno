/** @jsxImportSource hono/jsx */

import type { RenderTrace } from "../telemetry/telemetry.ts";
import type { LogEntry, PollHeaders } from "../device-state.ts";
import type { DeviceReport } from "../plugin/plugin.ts";
import type { BuildInfo } from "../build-info.ts";
import css from "./dashboard.css" with { type: "text" };
import js from "./dashboard.client.js" with { type: "text" };

// State the client-side scrub timeline needs, embedded into the page as
// `window.__DASH__`. All wall-clock math on the client is pure epoch-ms
// arithmetic; the client never computes a tz offset itself — the server
// embeds every boundary it needs, computed with `Temporal`. See ADR-0005.
export type TimelineState = {
  tz: string; // device tz id; client formats labels with it
  nowMs: number; // real `now`, epoch-ms
  dayStartMs: number; // displayed day's start midnight, epoch-ms
  dayEndMs: number; // displayed day's end midnight, epoch-ms
  scrubMs: number; // displayed instant (the scrub head's start), epoch-ms
  cache:
    | { cachedAtMs: number; expiresMs: number; identity: string }
    | null; // the Slot's current entry; `null` when the Slot is empty
};

export type DashboardProps = {
  now: Temporal.ZonedDateTime;
  // The instant the page is currently viewing — seeds the "jump to t" input.
  // On a plain GET / it equals `now`; on a ?t= / ?date= load it is the
  // resolved viewed instant, which may differ from the real clock.
  displayed: Temporal.ZonedDateTime;
  // `null` when the Slot is empty after a refill attempt (e.g. the
  // Conductor's error path itself failed) — the page surfaces that state
  // instead of embedding a broken /image URL.
  identity: string | null;
  refreshIn: Temporal.Duration | null;
  trace: RenderTrace | null;
  timeline: TimelineState;
  // Latest parsed DeviceReport (null until the Device has polled at least
  // once this process) plus an oldest-first slice of recent /api/log bodies.
  device: DeviceReport | null;
  // Raw Headers entries from the last poll that carried an ID — surfaced
  // in the device section's hover popover so the operator can see every
  // header firmware sent, not just the ones we parse into DeviceReport.
  rawHeaders: PollHeaders | null;
  logs: readonly LogEntry[];
  // Version + release instant of the running image; "<base>+dev" with no
  // date outside Docker. See ../build-info.ts.
  build: BuildInfo;
};

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

// The trace strip wants millisecond precision — render times are
// dominated by rasterize (CDP roundtrip + dither), typically 200–800 ms
// — and the rest of the page's fmtDuration() rounds to whole seconds.
function fmtDurationMs(d: Temporal.Duration): string {
  const ms = d.total({ unit: "milliseconds" });
  if (ms < 10) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// The "jump to t" form sends this value back as `?t=...`, so it must be a
// string `Temporal.ZonedDateTime.from` accepts. The full ZonedDateTime ISO
// string (with offset + bracketed time-zone id) round-trips losslessly.
function toScrubInputValue(t: Temporal.ZonedDateTime): string {
  return t.toString({ smallestUnit: "second" });
}

// "12s ago" / "4m ago" / "2h ago" / "3d ago" — server-side, computed at
// render time. The page already reloads on data-changing actions, so a
// frozen relative label is fine; no client tick needed.
function fmtAgo(then: Temporal.ZonedDateTime, now: Temporal.ZonedDateTime): string {
  const secs = Math.max(0, Math.round(now.since(then).total({ unit: "seconds" })));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Exported for reuse by the debug-mode page, which shows the same
// "what the Device last reported" block.
export function DeviceSection(
  { device, logs, now }: {
    device: DeviceReport | null;
    logs: readonly LogEntry[];
    now: Temporal.ZonedDateTime;
  },
) {
  // Logs come oldest-first from the ring; render newest-first so the most
  // recent line sits at the top of the scrollable list.
  const reversed = logs.slice().reverse();
  return (
    <>
      {device === null
        ? <p class="device-empty">no Device poll received yet</p>
        : (
          <div class="facts">
            <div class="fact">
              <span class="k">id</span>
              <span class="v">{device.id}</span>
            </div>
            <div class="fact">
              <span class="k">model</span>
              <span class="v">{device.model ?? "—"}</span>
            </div>
            <div class="fact">
              <span class="k">firmware</span>
              <span class="v">{device.fwVersion ?? "—"}</span>
            </div>
            <div class="fact">
              <span class="k">battery</span>
              <span class="v">
                {device.batteryPercent !== null ? `${device.batteryPercent}%` : "—"}
                {device.batteryVoltage !== null ? `  (${device.batteryVoltage.toFixed(2)} V)` : ""}
              </span>
            </div>
            <div class="fact">
              <span class="k">rssi</span>
              <span class="v">
                {device.rssi !== null ? `${device.rssi} dBm` : "—"}
              </span>
            </div>
            <div class="fact">
              <span class="k">dimensions</span>
              <span class="v">
                {device.width !== null && device.height !== null
                  ? `${device.width} × ${device.height}`
                  : "—"}
              </span>
            </div>
            <div class="fact">
              <span class="k">refresh rate</span>
              <span class="v">
                {device.refreshRate !== null ? `${device.refreshRate}s` : "—"}
              </span>
            </div>
            <div class="fact">
              <span class="k">last seen</span>
              <span class="v">
                {fmtTime(device.lastSeenAt)} ({fmtAgo(device.lastSeenAt, now)})
              </span>
            </div>
          </div>
        )}
      <div class="logs">
        <div class="logs-head">recent logs · since process start ({logs.length})</div>
        {reversed.length === 0 ? <div class="empty">no logs received yet</div> : (
          <ol>
            {reversed.map((entry) => (
              <li>
                <span class="ts">{fmtTime(entry.receivedAt)}</span>
                <span class="id">{entry.id}</span>
                <span class="body">{entry.body}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function TraceStrip({ trace }: { trace: RenderTrace | null }) {
  return (
    <div class="trace">
      <div class="trace-head">last render trace</div>
      {trace === null ? <p class="empty">no cycle has run yet</p> : (
        <>
          <div class="facts">
            <div class="fact">
              <span class="k">identity</span>
              <span class="v">{trace.identity}</span>
            </div>
            <div class="fact">
              <span class="k">ran at</span>
              <span class="v">{fmtTime(trace.ranAt)}</span>
            </div>
            <div class="fact">
              <span class="k">plugin run</span>
              <span class="v">{fmtDurationMs(trace.durations.pluginRun)}</span>
            </div>
            <div class="fact">
              <span class="k">identity hash</span>
              <span class="v">{fmtDurationMs(trace.durations.identity)}</span>
            </div>
            <div class="fact">
              <span class="k">rasterize</span>
              <span class="v">{fmtDurationMs(trace.durations.rasterize)}</span>
            </div>
          </div>
          {trace.error !== null
            ? (
              // `Error.stack` already begins with `Error: <message>` on every
              // engine we run on (V8 / Deno), so rendering both `message` and
              // `stack` would repeat the message verbatim. Fall back to
              // `message` only when `stack` is missing (defensive).
              <pre class="error">
                {trace.error.stack ?? trace.error.message}
              </pre>
            )
            : null}
        </>
      )}
    </div>
  );
}

export default function Dashboard(props: DashboardProps) {
  const { now, displayed, identity, refreshIn, trace, timeline, device, rawHeaders, logs, build } =
    props;
  // Embed the timeline state for the client script. `<` is escaped so a tz
  // id or identity can never break out of the inline <script>.
  const stateJson = JSON.stringify(timeline).replace(/</g, "\\u003c");
  // The date picker is seeded with the displayed day's calendar date so a
  // reload keeps the same day; submitting it navigates `GET /?date=`.
  const dayDate = Temporal.Instant.fromEpochMilliseconds(timeline.dayStartMs)
    .toZonedDateTimeISO(timeline.tz)
    .toPlainDate()
    .toString();
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos dashboard</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <header class="topbar">
          <h1>trmnl-byos dashboard</h1>
          <div class="meta">
            <div class="build">
              <code>{build.version}</code>
              {build.builtAt !== null
                ? <>{" · released "}{fmtTime(build.builtAt.toZonedDateTimeISO(now.timeZoneId))}</>
                : null}
            </div>
            <div class="now">
              now <code>{fmtTime(now)}</code> · <code>{now.timeZoneId}</code>
            </div>
          </div>
        </header>

        <section class="panel">
          <h2>timeline</h2>
          <div class="tl-controls">
            <form class="grp" method="get" action="/">
              <span>date</span>
              <input type="date" name="date" value={dayDate} />
              <button type="submit">go</button>
            </form>
            <div class="grp" id="grp-span">
              <span>span</span>
              <button type="button" data-v="1" class="on">1 h</button>
              <button type="button" data-v="3">3 h</button>
              <button type="button" data-v="6">6 h</button>
              <button type="button" data-v="12">12 h</button>
              <button type="button" data-v="24">24 h</button>
            </div>
            <form class="grp" method="get" action="/">
              <span>jump to t</span>
              <input
                type="text"
                name="t"
                value={toScrubInputValue(displayed)}
                size={42}
              />
              <button type="submit">go</button>
            </form>
          </div>
          <p class="hint">day overview · drag to move the detail window within the day</p>
          <div class="overview" id="overview">
            <div class="ov-rail"></div>
            <div class="ov-cache" id="ov-cache"></div>
            <div class="ov-now" id="ov-now"></div>
            <div class="ov-viewport" id="ov-viewport"></div>
            <div class="ov-viewport-frame" id="ov-viewport-frame"></div>
          </div>
          <p class="hint">
            detail · drag to scrub — the preview renders at the playhead on release
          </p>
          <div class="timeline-wrap" id="tl">
            <div class="track" id="track">
              <div class="rail"></div>
              <div class="rail-cap l"></div>
              <div class="rail-cap r"></div>
              <div class="cache-zone" id="cache-zone"></div>
              <div class="cache-cap" id="cache-cap"></div>
              <div class="now-mark" id="now-mark"></div>
              <div class="now-label" id="now-label">now</div>
              <div class="valid-bracket" id="valid-bracket"></div>
              <div class="valid-cap" id="valid-cap"></div>
              <div class="scrub-head" id="scrub">
                <div class="scrub-label" id="scrub-label">—</div>
                <div class="scrub-grip"></div>
              </div>
            </div>
            <div class="edge-label l" id="edge-l">—</div>
            <div class="span-label" id="span-label">—</div>
            <div class="edge-label r" id="edge-r">—</div>
          </div>
          <div class="tl-actions">
            <button type="button" id="snap-now">↩ snap to now</button>
            <span id="tl-hint"></span>
          </div>
          <div class="legend">
            <div>
              <span class="sw now"></span> now (fixed)
            </div>
            <div>
              <span class="sw scrub"></span> scrub playhead
            </div>
            <div>
              <span class="sw cache"></span> cached window — the Slot entry
            </div>
            <div>
              <span class="sw valid"></span> projected validity of the scrub render
            </div>
          </div>
        </section>

        <section class="panel preview">
          <h2>
            preview <span class="cap">— ephemeral render at the playhead</span>
          </h2>
          <div class="preview-frame" id="preview-frame">
            <img id="preview-img" alt="ephemeral preview render" />
            <div class="stale-chip">release to render</div>
            <div class="spinner-veil">
              <div class="spinner"></div>
              <span>rasterizing…</span>
            </div>
            <div class="preview-error">
              <span id="preview-error-text">render failed</span>
            </div>
          </div>
          <div class="preview-loupe" id="preview-loupe"></div>
          <div class="preview-footer">
            <div class="preview-summary">
              <div class="facts">
                <div class="fact">
                  <span class="k">rendered at t</span>
                  <span class="v lg" id="pv-time">—</span>
                </div>
                <div class="fact">
                  <span class="k">projected validity</span>
                  <span class="v" id="pv-validity">—</span>
                </div>
                <div class="fact">
                  <span class="k">render identity</span>
                  <span class="v" id="pv-id">—</span>
                </div>
              </div>
              <span class="badge" id="pv-badge">transient render</span>
            </div>
            <div class="api">
              <div class="api-head">GET /api/display — projected</div>
              <pre class="api-resp" id="api-resp">—</pre>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2>
            {"slot & trace "}
            <span class="cap">— live device-facing state</span>
          </h2>
          <div class="slot-bar">
            <div class="facts">
              <div class="fact">
                <span class="k">cached image</span>
                {identity !== null
                  ? <span class="v">{identity}</span>
                  : <span class="v muted">(none)</span>}
              </div>
              <div class="fact">
                <span class="k">refresh in</span>
                {refreshIn !== null
                  ? <span class="v">{fmtDuration(refreshIn)}</span>
                  : <span class="v muted">(unknown)</span>}
              </div>
            </div>
            <form method="post" action="/dashboard/clear">
              <button type="submit">clear cache</button>
            </form>
          </div>
          <TraceStrip trace={trace} />
        </section>

        <section class="panel">
          <h2>
            device <span class="cap">— what the Device last reported</span>
            {rawHeaders !== null && rawHeaders.length > 0
              ? (
                <span class="headers-pop">
                  <button type="button" class="trigger">raw headers</button>
                  <div class="panel">
                    <div class="panel-head">last poll · {rawHeaders.length} headers</div>
                    <table>
                      <tbody>
                        {rawHeaders.map(([name, value]) => (
                          <tr>
                            <td class="name">{name}</td>
                            <td class="value">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </span>
              )
              : null}
          </h2>
          <DeviceSection device={device} logs={logs} now={now} />
        </section>
        <script dangerouslySetInnerHTML={{ __html: `window.__DASH__ = ${stateJson};` }} />
        <script dangerouslySetInnerHTML={{ __html: js }} />
      </body>
    </html>
  );
}
