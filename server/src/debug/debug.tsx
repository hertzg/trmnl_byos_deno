/** @jsxImportSource hono/jsx */

import type { LogEntry, PollHeaders } from "../device-state.ts";
import type { DeviceReport } from "../plugin/plugin.ts";
import { DeviceSection } from "../dashboard/dashboard.tsx";
import { PATTERNS } from "./patterns.ts";
import type { DebugCustomImageInfo, DebugDisplayConfig } from "./debug.ts";
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
  generatedResponse: Record<string, unknown>;
  responseJsonError: string | null;
  proxyError: string | null;
  customImage: DebugCustomImageInfo | null;
  device: DeviceReport | null;
  rawHeaders: PollHeaders | null;
  logs: readonly LogEntry[];
};

function fmtTime(t: Temporal.ZonedDateTime): string {
  return t.toPlainDateTime().toString({ smallestUnit: "second" }).replace("T", " ");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

export default function DebugPage(props: DebugPageProps) {
  const {
    now,
    cfg,
    response,
    generatedResponse,
    responseJsonError,
    proxyError,
    customImage,
    device,
    rawHeaders,
    logs,
  } = props;
  const customCardClass = cfg.imageSource === "custom"
    ? "pattern-card pattern-card--custom is-selected"
    : "pattern-card pattern-card--custom";
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
            proxy mode <span class="cap">— forward device requests to another server</span>
          </h2>
          {cfg.proxyEnabled
            ? (
              <div class="dbg-note">
                proxy is active: non-debug requests are forwarded to <code>{cfg.proxyTarget}</code>.
              </div>
            )
            : null}
          {proxyError !== null
            ? <div class="dbg-error">proxy was not enabled: {proxyError}</div>
            : null}
          <form method="post" action="/debug/proxy" class="dbg-proxy-form">
            <div class="dbg-fields">
              <label class="chk">
                <input type="checkbox" name="proxyEnabled" checked={cfg.proxyEnabled} />
                proxy enabled
              </label>
              <label>
                target URL prefix
                <input
                  type="url"
                  name="proxyTarget"
                  value={cfg.proxyTarget}
                  placeholder="http://192.168.1.20:2300"
                  size={44}
                />
              </label>
            </div>
            <button type="submit">apply proxy</button>
          </form>
        </section>

        <section class="panel">
          <h2>
            response to device <span class="cap">— what the next /api/display poll gets</span>
          </h2>
          {cfg.proxyEnabled
            ? (
              <div class="dbg-note">
                proxy mode is active; /api/display is forwarded instead of using these generated
                response fields.
              </div>
            )
            : null}
          <form
            id="debug-config-form"
            method="post"
            action="/debug/config"
            enctype="multipart/form-data"
          >
            <div class="pattern-grid">
              {PATTERNS.map((p) => (
                <label class="pattern-card">
                  <input
                    type="radio"
                    name="pattern"
                    value={p.name}
                    checked={cfg.imageSource === "pattern" && cfg.pattern === p.name}
                  />
                  <img src={`/image/debug-${p.name}.png`} alt={p.title} loading="lazy" />
                  <span class="t">{p.title}</span>
                  <span class="d">{p.desc}</span>
                </label>
              ))}
              <input
                id="pattern-custom-radio"
                class="pattern-card-radio"
                type="radio"
                name="pattern"
                value="custom"
                checked={cfg.imageSource === "custom"}
                disabled={customImage === null}
              />
              <label class={customCardClass} for="customImage">
                {customImage
                  ? (
                    <img
                      src={`/image/debug-custom-${customImage.version}.png`}
                      alt={`custom upload ${customImage.filename}`}
                      loading="lazy"
                    />
                  )
                  : <span class="custom-placeholder">upload</span>}
                <span class="t">custom upload</span>
                <span class="d">
                  {customImage
                    ? `${customImage.filename} · ${fmtBytes(customImage.byteLength)} · ${
                      fmtTime(customImage.uploadedAt)
                    }`
                    : "click to select a file; it is kept in memory and used on the next poll"}
                </span>
              </label>
              <input
                id="customImage"
                class="custom-file-input"
                type="file"
                name="customImage"
                accept="image/*,.png,.bmp,.jpg,.jpeg"
                data-custom-image-input
              />
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
            {cfg.responseOverride !== null
              ? (
                <div class="dbg-note">
                  manual JSON response override is active; applying these controls switches back to
                  the generated response.
                </div>
              )
              : null}
            <button type="submit">apply</button>
          </form>
          <script
            dangerouslySetInnerHTML={{
              __html: `
const input = document.querySelector("[data-custom-image-input]");
const form = document.getElementById("debug-config-form");
const customRadio = document.getElementById("pattern-custom-radio");
input?.addEventListener("change", () => {
  if (input.files && input.files.length > 0) {
    if (customRadio) {
      customRadio.disabled = false;
      customRadio.checked = true;
    }
    if (form?.requestSubmit) form.requestSubmit();
    else form?.submit();
  }
});
`,
            }}
          />
        </section>

        <section class="panel">
          <h2>
            GET /api/display <span class="cap">— exact editable response</span>
          </h2>
          {cfg.proxyEnabled
            ? (
              <div class="dbg-note">
                proxy mode is active; this response is kept here but not served until proxy mode is
                disabled.
              </div>
            )
            : null}
          {responseJsonError !== null
            ? <div class="dbg-error">response JSON was not saved: {responseJsonError}</div>
            : null}
          <form method="post" action="/debug/response" class="dbg-response-form">
            <textarea name="responseJson" spellcheck={false}>
              {JSON.stringify(response, null, 2)}
            </textarea>
            <div class="dbg-actions">
              <button type="submit">save exact response</button>
              <span class="cap">
                {cfg.responseOverride !== null
                  ? "manual override active"
                  : "currently generated from controls"}
              </span>
            </div>
          </form>
          <form method="post" action="/debug/response/reset" class="dbg-reset-form">
            <button type="submit">reset to generated response</button>
          </form>
          {cfg.responseOverride !== null
            ? (
              <details class="dbg-generated">
                <summary>generated response from the controls</summary>
                <pre class="dbg-json">{JSON.stringify(generatedResponse, null, 2)}</pre>
              </details>
            )
            : null}
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
