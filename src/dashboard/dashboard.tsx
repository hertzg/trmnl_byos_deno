/** @jsxImportSource hono/jsx */

import type { RenderTrace } from "../telemetry/telemetry.ts";

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
  // `null` when the Slot is empty after a refill attempt (e.g. the
  // Conductor's error path itself failed) — the page surfaces that state
  // instead of embedding a broken /image URL.
  identity: string | null;
  refreshIn: Temporal.Duration | null;
  trace: RenderTrace | null;
  timeline: TimelineState;
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

const css = `
  html, body { margin: 0; padding: 0; background: #f4f4f4; color: #111; }
  body {
    font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
    padding: 24px;
    max-width: 1080px;
    margin: 0 auto;
  }
  h1 { margin: 0 0 16px; font-size: 20px; letter-spacing: -0.01em; }
  form { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  form label { font-size: 13px; color: #555; }
  form input[type="text"], form input[type="date"] {
    font: inherit; padding: 6px 8px; border: 1px solid #bbb; background: #fff;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }
  form button { font: inherit; padding: 6px 12px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
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
  table.meta .muted { color: #888; font-family: inherit; font-style: italic; }
  p.head { margin: 8px 0 16px; font-size: 12px; color: #555; }
  p.head code { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; }
  p.notice {
    margin: 0 0 16px; padding: 8px 12px; font-size: 13px;
    background: #fffbe6; border: 1px solid #f0c040; color: #663d00;
  }
  p.notice code { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  section.block { margin: 0 0 24px; }
  section.block > h2 {
    font-size: 14px; font-weight: 600; margin: 0 0 4px; color: #333;
    letter-spacing: 0.02em; text-transform: uppercase;
  }
  .sub { font-size: 12px; color: #999; margin: 0 0 8px; }
  hr.div { border: 0; border-top: 1px dashed #ccc; margin: 24px 0; }
  section.trace { margin-top: 24px; }
  section.trace h2 {
    font-size: 14px; font-weight: 600; margin: 0 0 8px;
    color: #333; letter-spacing: 0.02em; text-transform: uppercase;
  }
  section.trace .empty {
    padding: 8px 12px; font-size: 12px; color: #777; font-style: italic;
    background: #fafafa; border: 1px solid #eee;
  }
  section.trace pre.error {
    margin: 8px 0 0; padding: 8px 12px; font-size: 12px;
    background: #fff0f0; border: 1px solid #f3b0b0; color: #6b1212;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }

  /* ---- timeline controls (date picker + span buttons) ---- */
  .tl-controls {
    display: flex; gap: 22px; flex-wrap: wrap; align-items: center;
    font-size: 13px; margin: 0 0 12px;
  }
  .tl-controls .grp { display: flex; align-items: center; gap: 6px; }
  .tl-controls .grp > span { color: #888; margin-right: 2px; }
  .tl-controls button {
    font: inherit; padding: 4px 10px; border: 1px solid #bbb;
    background: #fff; color: #333; cursor: pointer; border-radius: 4px;
  }
  .tl-controls button.on { background: #111; color: #fff; border-color: #111; }

  /* ---- day overview strip ---- */
  .overview {
    position: relative; height: 34px; margin: 2px 4px 0;
    cursor: grab; touch-action: none; user-select: none;
  }
  .overview.grabbing { cursor: grabbing; }
  .ov-rail { position: absolute; left: 0; right: 0; top: 18px; height: 1px; background: #ccc; }
  .ov-tick { position: absolute; top: 15px; width: 1px; height: 7px; background: #e0e0e0; }
  .ov-tick-label {
    position: absolute; top: 23px; font-size: 9px; color: #c4c4c4;
    transform: translateX(-50%); white-space: nowrap;
  }
  .ov-now { position: absolute; top: 12px; height: 13px; width: 1.5px; background: #111; }
  .ov-cache {
    position: absolute; top: 14px; height: 9px; background: #f0dcb0;
    border: 1px solid #c2913a; box-sizing: border-box;
  }
  .ov-viewport {
    position: absolute; top: 8px; height: 21px; box-sizing: border-box;
    background: #111; opacity: 0.08; pointer-events: none;
  }
  .ov-viewport-frame {
    position: absolute; top: 8px; height: 21px; box-sizing: border-box;
    border: 1px solid #888; pointer-events: none;
  }

  /* ---- detail scrub track ---- */
  .timeline-wrap { position: relative; height: 150px; margin: 4px 4px 0; user-select: none; }
  .track {
    position: absolute; left: 0; right: 0; top: 30px; height: 92px;
    cursor: pointer; touch-action: none;
  }
  .rail { position: absolute; left: 0; right: 0; top: 36px; height: 1.5px; background: #111; }
  .rail-cap { position: absolute; top: 31px; width: 1.5px; height: 11px; background: #111; }
  .rail-cap.l { left: 0; }
  .rail-cap.r { right: 0; }
  .hour-tick { position: absolute; top: 32px; width: 1px; height: 9px; background: #ccc; }
  .hour-label {
    position: absolute; top: 72px; font-size: 10px; color: #aaa;
    font-variant-numeric: tabular-nums; transform: translateX(-50%); white-space: nowrap;
  }
  .edge-label {
    position: absolute; top: 110px; font-size: 11px; color: #888;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .edge-label.l { left: 0; }
  .edge-label.r { right: 0; }
  .span-label {
    position: absolute; top: 110px; left: 50%; transform: translateX(-50%);
    font-size: 11px; color: #bbb;
  }
  .cache-zone {
    position: absolute; top: 30px; height: 12px; box-sizing: border-box;
    background: #f0dcb0; border: 1px solid #c2913a;
  }
  .cache-zone.empty { display: none; }
  .cache-cap {
    position: absolute; top: 17px; font-size: 10px; color: #9a7320;
    white-space: nowrap; transform: translateX(-50%);
  }
  .cache-cap.empty { display: none; }
  .now-mark { position: absolute; top: 20px; bottom: 14px; width: 1.5px; background: #111; }
  .now-mark::after {
    content: ""; position: absolute; top: -5px; left: 50%; transform: translateX(-50%);
    width: 6px; height: 6px; background: #111;
  }
  .now-mark.off { display: none; }
  .now-label {
    position: absolute; top: 2px; font-size: 10px; color: #999;
    transform: translateX(-50%); white-space: nowrap;
  }
  .now-label.off { display: none; }
  .valid-bracket {
    position: absolute; top: 44px; height: 8px; box-sizing: border-box;
    border: 1px dashed #888; border-top: 0; display: none;
  }
  .valid-bracket.shown { display: block; }
  .valid-bracket.beyond { border-right: 0; }
  .valid-bracket.beyond::after {
    content: ""; position: absolute; right: -7px; top: 0;
    border-top: 4px solid transparent; border-bottom: 4px solid transparent;
    border-left: 6px solid #888;
  }
  .valid-cap {
    position: absolute; top: 54px; font-size: 10px; color: #888;
    white-space: nowrap; transform: translateX(-50%); display: none;
  }
  .valid-cap.shown { display: block; }
  .scrub-head {
    position: absolute; top: 20px; bottom: 10px; width: 1.5px;
    background: #111; cursor: grab;
  }
  .scrub-head.grabbing { cursor: grabbing; }
  .scrub-grip {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 0; height: 0; border-left: 6px solid transparent;
    border-right: 6px solid transparent; border-top: 9px solid #111;
  }
  .scrub-label {
    position: absolute; top: -17px; left: 50%; transform: translateX(-50%);
    font-size: 10px; font-weight: 700; color: #111; background: #fff;
    border: 1px solid #111; padding: 1px 4px; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .tl-actions {
    margin: 8px 4px 0; display: flex; gap: 10px; align-items: center;
    font-size: 12px; color: #999;
  }
  .tl-actions button {
    font: inherit; padding: 3px 9px; border: 1px solid #bbb; background: #fff;
    color: #333; cursor: pointer; border-radius: 4px;
  }
  .legend {
    display: flex; gap: 16px; flex-wrap: wrap; font-size: 11px; color: #888;
    margin: 10px 4px 0;
  }
  .legend > div { display: flex; align-items: center; gap: 6px; }
  .legend .sw { width: 20px; height: 10px; display: inline-block; box-sizing: border-box; }
  .legend .sw.cache { background: #f0dcb0; border: 1px solid #c2913a; }
  .legend .sw.valid { border: 1px dashed #888; border-top: 0; height: 7px; }
  .legend .sw.now { width: 1.5px; background: #111; }
  .legend .sw.scrub { width: 1.5px; background: #111; }

  /* ---- main preview — ephemeral render ---- */
  .preview-row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .preview-pane { position: relative; }
  .preview-frame {
    position: relative; background: #fff; border: 1px solid #ddd; padding: 10px;
    width: 460px; height: 276px; box-sizing: content-box;
  }
  .preview-frame.stale { border-style: dashed; border-color: #bbb; }
  .preview-frame img { display: block; width: 460px; height: 276px; image-rendering: pixelated; }
  .spinner-veil {
    position: absolute; inset: 10px; background: #ffffffcc;
    display: none; place-items: center; flex-direction: column; gap: 9px;
  }
  .preview-frame.busy .spinner-veil { display: grid; }
  .spinner {
    width: 26px; height: 26px; border: 3px solid #ddd; border-top-color: #111;
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner-veil span { font-size: 12px; color: #888; }
  .stale-chip {
    position: absolute; top: 18px; left: 18px; display: none;
    background: #444; color: #fff; font-size: 11px; padding: 2px 7px; border-radius: 3px;
  }
  .preview-frame.stale .stale-chip { display: block; }
  .preview-error {
    position: absolute; inset: 10px; background: #fff0f0; color: #6b1212;
    display: none; place-items: center; padding: 16px; box-sizing: border-box;
    font-size: 12px; text-align: center;
  }
  .preview-frame.errored .preview-error { display: grid; }
  .preview-meta { font-size: 13px; min-width: 250px; }
  .preview-meta .pm-row { margin: 0 0 8px; }
  .preview-meta .pm-k {
    color: #999; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .preview-meta .pm-v {
    font-family: ui-monospace, "SF Mono", Menlo, monospace; color: #111; font-size: 13px;
  }
  .preview-meta .pm-v.big { font-size: 14px; font-weight: 700; }
  .badge {
    display: inline-block; font-size: 11px; padding: 2px 7px; border-radius: 3px;
    margin-top: 2px; border: 1px solid #ccc; background: #f3f3f3; color: #666;
  }
  .badge.match { border-color: #111; background: #fff; color: #111; font-weight: 700; }

  /* ---- projected /api/display response ---- */
  pre.api-resp {
    margin: 0; background: #f6f6f6; border: 1px solid #ddd; padding: 12px 14px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: #222;
    white-space: pre; overflow-x: auto; line-height: 1.5; display: inline-block;
    min-width: 360px;
  }
`;

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
    spanKey: 3, scrubMs: DASH.scrubMs, winStart: 0,
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
  var previewFrame = $("preview-frame"), previewImg = $("preview-img");

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

  // ---- span buttons (client-side; default 3 h, no persistence) -------
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

  // ---- boot ----------------------------------------------------------
  state.winStart = state.scrubMs - spanMs() / 2;
  relayout();
  doRender(state.scrubMs);
})();
`;

function TraceStrip({ trace }: { trace: RenderTrace | null }) {
  if (trace === null) {
    return (
      <section class="trace">
        <h2>last render trace</h2>
        <p class="empty">no cycle has run yet</p>
      </section>
    );
  }
  return (
    <section class="trace">
      <h2>last render trace</h2>
      <table class="meta">
        <tbody>
          <tr>
            <th scope="row">identity</th>
            <td>{trace.identity}</td>
          </tr>
          <tr>
            <th scope="row">ran at</th>
            <td>{fmtTime(trace.ranAt)}</td>
          </tr>
          <tr>
            <th scope="row">plugin run</th>
            <td>{fmtDurationMs(trace.durations.pluginRun)}</td>
          </tr>
          <tr>
            <th scope="row">identity hash</th>
            <td>{fmtDurationMs(trace.durations.identity)}</td>
          </tr>
          <tr>
            <th scope="row">rasterize</th>
            <td>{fmtDurationMs(trace.durations.rasterize)}</td>
          </tr>
        </tbody>
      </table>
      {trace.error !== null
        ? (
          // `Error.stack` already begins with `Error: <message>` on every
          // engine we run on (V8 / Deno), so rendering both `message` and
          // `stack` would repeat the message verbatim at the top of the
          // block. Fall back to `message` only when `stack` is missing
          // (defensive — shouldn't happen in practice).
          <pre class="error">
            {trace.error.stack ?? trace.error.message}
          </pre>
        )
        : null}
    </section>
  );
}

export default function Dashboard(props: DashboardProps) {
  const { now, identity, refreshIn, trace, timeline } = props;
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
        <h1>dashboard</h1>
        <p class="head">
          now: <code>{fmtTime(now)}</code> · timezone: <code>{now.timeZoneId}</code>
        </p>

        <section class="block">
          <h2>scrub timeline</h2>
          <div class="tl-controls">
            <form class="grp" method="get" action="/">
              <span>date</span>
              <input type="date" name="date" value={dayDate} />
              <button type="submit">go</button>
            </form>
            <div class="grp" id="grp-span">
              <span>span</span>
              <button type="button" data-v="1">1 h</button>
              <button type="button" data-v="3" class="on">3 h</button>
              <button type="button" data-v="6">6 h</button>
              <button type="button" data-v="12">12 h</button>
              <button type="button" data-v="24">24 h</button>
            </div>
            <form class="grp" method="get" action="/">
              <span>jump to t</span>
              <input
                type="text"
                name="t"
                value={toScrubInputValue(now)}
                size={42}
              />
              <button type="submit">go</button>
            </form>
          </div>
          <p class="sub">day overview — drag to move the detail window within the day</p>
          <div class="overview" id="overview">
            <div class="ov-rail"></div>
            <div class="ov-cache" id="ov-cache"></div>
            <div class="ov-now" id="ov-now"></div>
            <div class="ov-viewport" id="ov-viewport"></div>
            <div class="ov-viewport-frame" id="ov-viewport-frame"></div>
          </div>
          <p class="sub">detail — drag to scrub; the preview renders at the playhead on release</p>
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

        <section class="block">
          <h2>main preview — ephemeral render at the playhead</h2>
          <p class="sub">
            Every scrub position renders fresh, as if the cache were invalidated at that instant.
            The Slot is never touched.
          </p>
          <div class="preview-row">
            <div class="preview-pane">
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
            </div>
            <div class="preview-meta">
              <div class="pm-row">
                <div class="pm-k">rendered at t</div>
                <div class="pm-v big" id="pv-time">—</div>
              </div>
              <div class="pm-row">
                <div class="pm-k">projected validity</div>
                <div class="pm-v" id="pv-validity">—</div>
              </div>
              <div class="pm-row">
                <div class="pm-k">render identity</div>
                <div class="pm-v" id="pv-id">—</div>
              </div>
              <div class="pm-row">
                <span class="badge" id="pv-badge">transient render</span>
              </div>
            </div>
          </div>
        </section>

        <section class="block">
          <h2>GET /api/display — projected response</h2>
          <p class="sub">
            The JSON the Server would answer a Device poll at the scrub head — identity, image URL,
            and refresh_rate (the render's validity in seconds). Ephemeral: this poll is not
            actually performed.
          </p>
          <pre class="api-resp" id="api-resp">—</pre>
        </section>

        <hr class="div" />

        <form method="post" action="/dashboard/clear">
          <button type="submit">clear cache</button>
        </form>
        {identity !== null
          ? (
            <div class="image-frame">
              <img src={`/image/${identity}.png`} alt="current Image" />
            </div>
          )
          : (
            <p class="notice">
              Slot is empty — Conductor refill failed. Try reloading the page.
            </p>
          )}
        <table class="meta">
          <tbody>
            <tr>
              <th scope="row">identity</th>
              <td>{identity ?? <span class="muted">(none)</span>}</td>
            </tr>
            <tr>
              <th scope="row">refresh in</th>
              <td>
                {refreshIn !== null ? fmtDuration(refreshIn) : <span class="muted">(unknown)</span>}
              </td>
            </tr>
          </tbody>
        </table>
        <TraceStrip trace={trace} />
        <script dangerouslySetInnerHTML={{ __html: `window.__DASH__ = ${stateJson};` }} />
        <script dangerouslySetInnerHTML={{ __html: js }} />
      </body>
    </html>
  );
}
