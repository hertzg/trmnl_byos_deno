/** @jsxImportSource hono/jsx */

import type { RenderTrace } from "../telemetry/telemetry.ts";
import type { LogEntry, PollHeaders } from "../device-state.ts";
import type { DeviceReport } from "../plugin/plugin.ts";
import css from "./dashboard.css" with { type: "text" };

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

// The scrub timeline — the dashboard's only client-side JavaScript. Adapted
// from src/dashboard/wireframes-scrub-v3.html: the geometry and the
// drag/pan interaction are lifted near-verbatim; the data layer is rewired
// to the real Server. The transient render fetches /dashboard/preview.png
// and reads X-Identity / X-Validity from the response. All wall-clock math
// is pure epoch-ms arithmetic; every label is formatted via Intl with the
// device tz id (window.__DASH__.tz) — the client never computes an offset.
const js = `
"use strict";
(function () {
  var DASH = window.__DASH__;
  var DAY = 24 * 3600 * 1000, MIN = 60 * 1000, HOUR = 3600 * 1000;
  var SPAN_MS = { 1: HOUR, 3: 3 * HOUR, 6: 6 * HOUR, 12: 12 * HOUR, 24: DAY };

  // Day boundaries come from the server (computed with Temporal, DST-aware).
  // dayLen may be 23 h or 25 h on a DST transition day.
  var dayStart = DASH.dayStartMs, dayEnd = DASH.dayEndMs;
  var dayLen = dayEnd - dayStart;
  var NOW = DASH.nowMs;

  var state = {
    spanKey: 1, scrubMs: DASH.scrubMs, winStart: 0,
    renderGen: 0, dragScrub: false, dragPan: false,
  };

  // ---- formatters: built once, reused. Every wall-clock label goes
  // through Intl with the device tz id — never local Date getters.
  var fHM = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  var fHMS = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  var fDate = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz, weekday: "short", month: "short", day: "numeric",
  });
  function fmtHM(ms) { return fHM.format(new Date(ms)); }
  function fmtHMS(ms) { return fHMS.format(new Date(ms)); }
  function fmtDate(ms) { return fDate.format(new Date(ms)); }
  // fmtDur is pure math — no tz involved.
  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    if (s < 90) return s + "s";
    var m = Math.floor(s / 60), rs = s % 60;
    if (m < 90) return rs ? m + "m " + rs + "s" : m + "m";
    var h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  }

  var $ = function (id) { return document.getElementById(id); };
  var overview = $("overview"), ovViewport = $("ov-viewport"),
      ovViewportFrame = $("ov-viewport-frame"), ovNow = $("ov-now"), ovCache = $("ov-cache");
  var track = $("track"), scrub = $("scrub"), scrubLabel = $("scrub-label");
  var cacheZone = $("cache-zone"), cacheCap = $("cache-cap");
  var nowMark = $("now-mark"), nowLabel = $("now-label");
  var vBracket = $("valid-bracket"), vCap = $("valid-cap");
  var previewFrame = $("preview-frame"), previewImg = $("preview-img"),
      loupe = $("preview-loupe");

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function spanMs() { return Math.min(SPAN_MS[state.spanKey], dayLen); }
  function winEnd() { return state.winStart + spanMs(); }
  function clampWindow() {
    var sp = spanMs();
    if (sp >= dayLen) { state.winStart = dayStart; return; }
    state.winStart = clamp(state.winStart, dayStart, dayEnd - sp);
  }
  function fracDetail(ms) { return (ms - state.winStart) / spanMs(); }
  function detailAt(frac) { return state.winStart + frac * spanMs(); }
  function fracDay(ms) { return (ms - dayStart) / dayLen; }
  function nowVisibleOnDay() { return NOW >= dayStart && NOW < dayEnd; }

  // ---- day overview strip --------------------------------------------
  var ovTickEls = [];
  function layoutOverview() {
    ovTickEls.forEach(function (e) { e.remove(); });
    ovTickEls = [];
    for (var h = 0; h <= 24; h += 3) {
      var f = h / 24;
      var tk = document.createElement("div");
      tk.className = "ov-tick"; tk.style.left = (f * 100) + "%";
      overview.appendChild(tk); ovTickEls.push(tk);
      if (h % 6 === 0 && h < 24) {
        var lb = document.createElement("div");
        lb.className = "ov-tick-label"; lb.style.left = (f * 100) + "%";
        lb.textContent = fmtHM(dayStart + h * HOUR);
        overview.appendChild(lb); ovTickEls.push(lb);
      }
    }
    if (nowVisibleOnDay()) {
      ovNow.style.display = "block";
      ovNow.style.left = (fracDay(NOW) * 100) + "%";
    } else {
      ovNow.style.display = "none";
    }
    var cacheOnDay = DASH.cache && DASH.cache.expiresMs > dayStart &&
      DASH.cache.cachedAtMs < dayEnd;
    if (cacheOnDay) {
      ovCache.style.display = "block";
      var cl = clamp(fracDay(DASH.cache.cachedAtMs), 0, 1) * 100;
      var cr = clamp(fracDay(DASH.cache.expiresMs), 0, 1) * 100;
      ovCache.style.left = cl + "%";
      ovCache.style.width = Math.max(cr - cl, 0.3) + "%";
    } else {
      ovCache.style.display = "none";
    }
    var vl = fracDay(state.winStart) * 100, vw = spanMs() / dayLen * 100;
    ovViewport.style.left = vl + "%"; ovViewport.style.width = vw + "%";
    ovViewportFrame.style.left = vl + "%"; ovViewportFrame.style.width = vw + "%";
  }

  // ---- detail track --------------------------------------------------
  var hourEls = [];
  function tickStep() {
    var sp = spanMs();
    if (sp <= HOUR) return 10 * MIN;
    if (sp <= 3 * HOUR) return 30 * MIN;
    if (sp <= 6 * HOUR) return HOUR;
    if (sp <= 12 * HOUR) return 2 * HOUR;
    return 3 * HOUR;
  }
  function buildHourTicks() {
    hourEls.forEach(function (e) { e.remove(); });
    hourEls = [];
    var step = tickStep();
    var first = Math.ceil(state.winStart / step) * step;
    for (var t = first; t < winEnd(); t += step) {
      var f = fracDetail(t);
      var tick = document.createElement("div");
      tick.className = "hour-tick"; tick.style.left = (f * 100) + "%";
      var lab = document.createElement("div");
      lab.className = "hour-label"; lab.style.left = (f * 100) + "%";
      lab.textContent = fmtHM(t);
      track.appendChild(tick); track.appendChild(lab);
      hourEls.push(tick, lab);
    }
  }

  function layoutDetail() {
    var nf = fracDetail(NOW);
    var nowIn = nowVisibleOnDay() && nf >= 0 && nf <= 1;
    nowMark.classList.toggle("off", !nowIn);
    nowLabel.classList.toggle("off", !nowIn);
    if (nowIn) {
      nowMark.style.left = (nf * 100) + "%";
      nowLabel.style.left = (nf * 100) + "%";
      nowLabel.textContent = "now " + fmtHM(NOW);
    }
    var showCache = DASH.cache &&
      DASH.cache.expiresMs > state.winStart && DASH.cache.cachedAtMs < winEnd();
    cacheZone.classList.toggle("empty", !showCache);
    cacheCap.classList.toggle("empty", !showCache);
    if (showCache) {
      var cl = clamp(fracDetail(DASH.cache.cachedAtMs), 0, 1) * 100;
      var cr = clamp(fracDetail(DASH.cache.expiresMs), 0, 1) * 100;
      cacheZone.style.left = cl + "%";
      cacheZone.style.width = (cr - cl) + "%";
      cacheCap.style.left = ((cl + cr) / 2) + "%";
      cacheCap.textContent = "cached · valid " +
        fmtDur(DASH.cache.expiresMs - DASH.cache.cachedAtMs);
    }
    $("edge-l").textContent = fmtHM(state.winStart);
    $("edge-r").textContent = fmtHM(winEnd());
    $("span-label").textContent = "◄ " + state.spanKey + " h ►";
    layoutScrub();
  }

  // layoutScrub only POSITIONS the head + its label. Validity and identity
  // are unknowable without a completed render (ADR-0005), so the bracket and
  // the readouts are filled in by applyRender(), never here.
  function layoutScrub() {
    var sf = clamp(fracDetail(state.scrubMs), 0, 1);
    scrub.style.left = (sf * 100) + "%";
    scrubLabel.textContent = fmtHM(state.scrubMs);
  }

  // Draw the validity bracket + the render-derived readouts from a completed
  // render's headers. validitySeconds may be fractional — the client rounds
  // for display; the projected refresh_rate ceils (matches conductor.ts).
  function applyRender(tMs, identity, validitySeconds) {
    var validityMs = validitySeconds * 1000;
    var endMs = tMs + validityMs;
    var sf = clamp(fracDetail(tMs), 0, 1);
    var rawEf = fracDetail(endMs);
    var beyond = rawEf > 1;
    var ef = clamp(rawEf, 0, 1);
    vBracket.classList.add("shown");
    vCap.classList.add("shown");
    vBracket.style.left = (sf * 100) + "%";
    vBracket.style.width = ((ef - sf) * 100) + "%";
    vBracket.classList.toggle("beyond", beyond);
    vCap.style.left = ((sf + ef) / 2 * 100) + "%";
    vCap.textContent = "valid " + fmtDur(validityMs);

    $("pv-time").textContent = fmtDate(tMs) + " · " + fmtHMS(tMs);
    $("pv-validity").textContent = fmtDur(validityMs) + "  (until " + fmtHM(endMs) + ")";
    $("pv-id").textContent = identity;

    var cachedId = DASH.cache ? DASH.cache.identity : null;
    var match = cachedId !== null && identity === cachedId;
    var badge = $("pv-badge");
    badge.className = match ? "badge match" : "badge";
    badge.textContent = match
      ? "≡ matches cached Image — " + identity
      : (cachedId !== null
        ? "transient — distinct from cached " + cachedId
        : "transient render (Slot empty)");

    // Projected /api/display — derived purely from this render's headers.
    var refreshRate = Math.max(1, Math.ceil(validitySeconds));
    $("api-resp").textContent =
      "GET /api/display          200 OK · application/json\\n\\n" +
      "{\\n" +
      '  "image_url": "/image/' + identity + '.png",\\n' +
      '  "filename": "image-' + identity + '",\\n' +
      '  "refresh_rate": ' + refreshRate + "\\n" +
      "}";
  }

  var lastObjectUrl = null;
  function showRenderError(msg) {
    previewFrame.classList.remove("busy");
    previewFrame.classList.add("errored");
    $("preview-error-text").textContent = msg;
  }

  // The transient render. Builds the scrub ISO from epoch-ms with no offset
  // math — \`new Date(ms).toISOString()\` is UTC, and the bracketed tz id lets
  // the server's Temporal.ZonedDateTime.from re-anchor it exactly (verified
  // to round-trip across DST). renderGen ignores a superseded in-flight one.
  function doRender(tMs) {
    var gen = ++state.renderGen;
    previewFrame.classList.remove("stale", "errored");
    previewFrame.classList.add("busy");
    var iso = new Date(tMs).toISOString() + "[" + DASH.tz + "]";
    fetch("/dashboard/preview.png?t=" + encodeURIComponent(iso))
      .then(function (res) {
        if (gen !== state.renderGen) return null;
        if (!res.ok) {
          showRenderError("render failed — HTTP " + res.status);
          return null;
        }
        var identity = res.headers.get("X-Identity") || "";
        var validitySeconds = Number(res.headers.get("X-Validity"));
        return res.blob().then(function (blob) {
          if (gen !== state.renderGen) return;
          previewFrame.classList.remove("busy");
          if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
          lastObjectUrl = URL.createObjectURL(blob);
          previewImg.src = lastObjectUrl;
          applyRender(tMs, identity, validitySeconds);
        });
      })
      .catch(function () {
        if (gen !== state.renderGen) return;
        showRenderError("render failed — network error");
      });
  }

  // ---- detail-track drag = scrub (render on release) -----------------
  function scrubFromEvent(e) {
    var r = track.getBoundingClientRect();
    var f = clamp((e.clientX - r.left) / r.width, 0, 1);
    state.scrubMs = detailAt(f);
    layoutScrub();
    previewFrame.classList.add("stale"); // preview re-renders only on release
  }
  track.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    state.dragScrub = true;
    scrub.classList.add("grabbing");
    scrubFromEvent(e);
  });
  track.addEventListener("pointermove", function (e) {
    if (state.dragScrub) scrubFromEvent(e);
  });
  function endScrub() {
    if (!state.dragScrub) return;
    state.dragScrub = false;
    scrub.classList.remove("grabbing");
    doRender(state.scrubMs);
  }
  track.addEventListener("pointerup", endScrub);
  track.addEventListener("pointercancel", endScrub);

  // ---- overview-strip drag = pan the detail window -------------------
  function panFromEvent(e) {
    var r = overview.getBoundingClientRect();
    var f = clamp((e.clientX - r.left) / r.width, 0, 1);
    state.winStart = (dayStart + f * dayLen) - spanMs() / 2;
    clampWindow();
    state.scrubMs = clamp(state.scrubMs, state.winStart, winEnd());
    buildHourTicks();
    layoutOverview();
    layoutDetail();
  }
  overview.addEventListener("pointerdown", function (e) {
    if (spanMs() >= dayLen) return;
    e.preventDefault();
    overview.setPointerCapture(e.pointerId);
    state.dragPan = true;
    overview.classList.add("grabbing");
    panFromEvent(e);
  });
  overview.addEventListener("pointermove", function (e) {
    if (state.dragPan) panFromEvent(e);
  });
  function endPan() {
    if (!state.dragPan) return;
    state.dragPan = false;
    overview.classList.remove("grabbing");
    doRender(state.scrubMs);
  }
  overview.addEventListener("pointerup", endPan);
  overview.addEventListener("pointercancel", endPan);

  function relayout() {
    clampWindow();
    buildHourTicks();
    layoutOverview();
    layoutDetail();
  }

  // ---- span buttons (client-side; default 1 h, no persistence) -------
  var spanGrp = $("grp-span");
  spanGrp.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    [].forEach.call(spanGrp.querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b === btn);
    });
    state.spanKey = Number(btn.dataset.v);
    state.winStart = state.scrubMs - spanMs() / 2;
    relayout();
    $("tl-hint").textContent = spanMs() >= dayLen
      ? "whole day in view; nothing to pan" : "";
    doRender(state.scrubMs);
  });

  $("snap-now").addEventListener("click", function () {
    if (!nowVisibleOnDay()) return; // now is on another day — date change navigates
    state.scrubMs = NOW;
    state.winStart = NOW - spanMs() / 2;
    relayout();
    doRender(state.scrubMs);
  });

  // ---- preview loupe -------------------------------------------------
  // Hovering the preview floats a fixed box showing the region under the
  // cursor at the rendered Image's native 1:1 resolution. The inline
  // preview is downscaled to fit the column, so the loupe is the only way
  // to inspect the real e-ink dither pixel-for-pixel.
  function moveLoupe(e) {
    if (e.pointerType === "touch") return; // no hover affordance on touch
    var nw = previewImg.naturalWidth, nh = previewImg.naturalHeight;
    if (!nw) return; // nothing rendered yet
    loupe.classList.add("shown"); // display:block so clientWidth is measurable
    var lw = loupe.clientWidth, lh = loupe.clientHeight;
    var fr = previewFrame.getBoundingClientRect();
    var fx = clamp((e.clientX - fr.left - previewImg.offsetLeft) / previewImg.offsetWidth, 0, 1);
    var fy = clamp((e.clientY - fr.top - previewImg.offsetTop) / previewImg.offsetHeight, 0, 1);
    // 1:1 native pixels; background-position centres the cursor's point.
    loupe.style.backgroundImage = "url(" + previewImg.src + ")";
    loupe.style.backgroundSize = nw + "px " + nh + "px";
    loupe.style.backgroundPosition =
      (lw / 2 - fx * nw) + "px " + (lh / 2 - fy * nh) + "px";
    // Float just off the cursor, clamped to stay on screen.
    loupe.style.left = clamp(e.clientX + 24, 8, window.innerWidth - lw - 8) + "px";
    loupe.style.top = clamp(e.clientY + 24, 8, window.innerHeight - lh - 8) + "px";
  }
  previewFrame.addEventListener("pointermove", moveLoupe);
  previewFrame.addEventListener("pointerleave", function () {
    loupe.classList.remove("shown");
  });

  // ---- boot ----------------------------------------------------------
  state.winStart = state.scrubMs - spanMs() / 2;
  relayout();
  doRender(state.scrubMs);
})();
`;

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

function DeviceSection(
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
  const { now, displayed, identity, refreshIn, trace, timeline, device, rawHeaders, logs } = props;
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
          <div class="now">
            now <code>{fmtTime(now)}</code> · <code>{now.timeZoneId}</code>
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
