/** @jsxImportSource hono/jsx */

import type { LogEntry, PollHeaders } from "../device-state.ts";
import type { DeviceReport } from "../plugin/plugin.ts";
import { DeviceSection } from "../dashboard/dashboard.tsx";
import { PATTERNS } from "./patterns.ts";
import type { DebugDisplayConfig } from "./debug.ts";
import dashboardCss from "../dashboard/dashboard.css" with { type: "text" };
import debugCss from "./debug.css" with { type: "text" };

// Debug-mode control panel. Rendered instead of the dashboard when
// system.debug is true: the operator dictates the /api/display response
// field by field, picks a built-in test pattern, and sees everything the
// Device sent back. No Plugin, no CDP — the page must work with nothing
// but the Deno process running.

export type DebugPageProps = {
  now: Temporal.ZonedDateTime;
  cfg: DebugDisplayConfig;
  // The exact /api/display JSON the next poll will receive, resolved
  // against this page request's own origin.
  response: Record<string, unknown>;
  device: DeviceReport | null;
  rawHeaders: PollHeaders | null;
  logs: readonly LogEntry[];
};

function fmtTime(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ");
}

export default function DebugPage(props: DebugPageProps) {
  const { now, cfg, response, device, rawHeaders, logs } = props;
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>trmnl-byos debug mode</title>
        <style dangerouslySetInnerHTML={{ __html: dashboardCss }} />
        <style dangerouslySetInnerHTML={{ __html: debugCss }} />
      </head>
      <body>
        <header class="topbar">
          <h1>trmnl-byos debug mode</h1>
          <div class="now">
            now <code>{fmtTime(now)}</code> · <code>{now.timeZoneId}</code>
          </div>
        </header>

        <div class="debug-banner">
          Debug mode is on: the normal pipeline (Plugin, renderer, Slot) is not running and the
          Device is served exactly what is configured below. To go back to normal, set{" "}
          <code>debug: false</code> in <code>config/live/system.ts</code>{" "}
          (webproc settings page) and restart.
        </div>

        <section class="panel">
          <h2>
            response to device <span class="cap">— what the next /api/display poll gets</span>
          </h2>
          <form method="post" action="/debug/config">
            <div class="pattern-grid">
              {PATTERNS.map((p) => (
                <label class="pattern-card">
                  <input
                    type="radio"
                    name="pattern"
                    value={p.name}
                    checked={cfg.pattern === p.name}
                  />
                  <img src={`/image/debug-${p.name}.png`} alt={p.title} loading="lazy" />
                  <span class="t">{p.title}</span>
                  <span class="d">{p.desc}</span>
                </label>
              ))}
            </div>
            <div class="dbg-fields">
              <label>
                refresh_rate (s)
                <input type="number" name="refreshRate" value={String(cfg.refreshRate)} min="1" />
              </label>
              <label>
                status
                <input type="number" name="status" value={String(cfg.status)} />
              </label>
              <label>
                temperature_profile
                <input
                  type="text"
                  name="temperatureProfile"
                  value={cfg.temperatureProfile}
                  size={8}
                />
              </label>
              <label>
                special_function
                <input type="text" name="specialFunction" value={cfg.specialFunction} size={12} />
              </label>
              <label class="chk">
                <input type="checkbox" name="resetFirmware" checked={cfg.resetFirmware} />
                reset_firmware
              </label>
              <label class="chk">
                <input type="checkbox" name="updateFirmware" checked={cfg.updateFirmware} />
                update_firmware
              </label>
              <label>
                firmware_url
                <input type="text" name="firmwareUrl" value={cfg.firmwareUrl} size={36} />
              </label>
            </div>
            <button type="submit">apply</button>
          </form>
        </section>

        <section class="panel">
          <h2>
            GET /api/display <span class="cap">— exact response</span>
          </h2>
          <pre class="dbg-json">{JSON.stringify(response, null, 2)}</pre>
        </section>

        <section class="panel">
          <h2>
            received from device <span class="cap">— headers, report, logs</span>
          </h2>
          <DeviceSection device={device} logs={logs} now={now} />
          {rawHeaders !== null && rawHeaders.length > 0
            ? (
              <div class="dbg-headers">
                <div class="head">raw headers of the last poll ({rawHeaders.length})</div>
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
            )
            : null}
        </section>
      </body>
    </html>
  );
}
