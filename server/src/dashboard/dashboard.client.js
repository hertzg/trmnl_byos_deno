// deno-lint-ignore-file no-var no-window no-inner-declarations
// Browser code, not Deno code: this file is inlined into the dashboard page
// via a text import (see dashboard.tsx), so Deno-runtime lint rules do not
// apply.
//
// The scrub timeline — the dashboard's only client-side JavaScript. Adapted
// from wireframes-scrub-v3.html (sibling file): the geometry and the
// drag/pan interaction are lifted near-verbatim; the data layer is rewired
// to the real Server. The transient render fetches /dashboard/preview.png
// and reads X-Identity / X-Validity from the response. All wall-clock math
// is pure epoch-ms arithmetic; every label is formatted via Intl with the
// device tz id (window.__DASH__.tz) — the client never computes an offset.
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
    spanKey: 1,
    scrubMs: DASH.scrubMs,
    winStart: 0,
    renderGen: 0,
    dragScrub: false,
    dragPan: false,
  };

  // ---- formatters: built once, reused. Every wall-clock label goes
  // through Intl with the device tz id — never local Date getters.
  var fHM = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  var fHMS = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  var fDate = new Intl.DateTimeFormat(undefined, {
    timeZone: DASH.tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  function fmtHM(ms) {
    return fHM.format(new Date(ms));
  }
  function fmtHMS(ms) {
    return fHMS.format(new Date(ms));
  }
  function fmtDate(ms) {
    return fDate.format(new Date(ms));
  }
  // fmtDur is pure math — no tz involved.
  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    if (s < 90) return s + "s";
    var m = Math.floor(s / 60), rs = s % 60;
    if (m < 90) return rs ? m + "m " + rs + "s" : m + "m";
    var h = Math.floor(m / 60);
    return h + "h " + (m % 60) + "m";
  }

  var $ = function (id) {
    return document.getElementById(id);
  };
  var overview = $("overview"),
    ovViewport = $("ov-viewport"),
    ovViewportFrame = $("ov-viewport-frame"),
    ovNow = $("ov-now"),
    ovCache = $("ov-cache");
  var track = $("track"), scrub = $("scrub"), scrubLabel = $("scrub-label");
  var cacheZone = $("cache-zone"), cacheCap = $("cache-cap");
  var nowMark = $("now-mark"), nowLabel = $("now-label");
  var vBracket = $("valid-bracket"), vCap = $("valid-cap");
  var previewFrame = $("preview-frame"), previewImg = $("preview-img"), loupe = $("preview-loupe");

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function spanMs() {
    return Math.min(SPAN_MS[state.spanKey], dayLen);
  }
  function winEnd() {
    return state.winStart + spanMs();
  }
  function clampWindow() {
    var sp = spanMs();
    if (sp >= dayLen) {
      state.winStart = dayStart;
      return;
    }
    state.winStart = clamp(state.winStart, dayStart, dayEnd - sp);
  }
  function fracDetail(ms) {
    return (ms - state.winStart) / spanMs();
  }
  function detailAt(frac) {
    return state.winStart + frac * spanMs();
  }
  function fracDay(ms) {
    return (ms - dayStart) / dayLen;
  }
  function nowVisibleOnDay() {
    return NOW >= dayStart && NOW < dayEnd;
  }

  // ---- day overview strip --------------------------------------------
  var ovTickEls = [];
  function layoutOverview() {
    ovTickEls.forEach(function (e) {
      e.remove();
    });
    ovTickEls = [];
    for (var h = 0; h <= 24; h += 3) {
      var f = h / 24;
      var tk = document.createElement("div");
      tk.className = "ov-tick";
      tk.style.left = (f * 100) + "%";
      overview.appendChild(tk);
      ovTickEls.push(tk);
      if (h % 6 === 0 && h < 24) {
        var lb = document.createElement("div");
        lb.className = "ov-tick-label";
        lb.style.left = (f * 100) + "%";
        lb.textContent = fmtHM(dayStart + h * HOUR);
        overview.appendChild(lb);
        ovTickEls.push(lb);
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
    ovViewport.style.left = vl + "%";
    ovViewport.style.width = vw + "%";
    ovViewportFrame.style.left = vl + "%";
    ovViewportFrame.style.width = vw + "%";
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
    hourEls.forEach(function (e) {
      e.remove();
    });
    hourEls = [];
    var step = tickStep();
    var first = Math.ceil(state.winStart / step) * step;
    for (var t = first; t < winEnd(); t += step) {
      var f = fracDetail(t);
      var tick = document.createElement("div");
      tick.className = "hour-tick";
      tick.style.left = (f * 100) + "%";
      var lab = document.createElement("div");
      lab.className = "hour-label";
      lab.style.left = (f * 100) + "%";
      lab.textContent = fmtHM(t);
      track.appendChild(tick);
      track.appendChild(lab);
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
    $("api-resp").textContent = "GET /api/display          200 OK · application/json\n\n" +
      "{\n" +
      '  "image_url": "/image/' + identity + '.png",\n' +
      '  "filename": "image-' + identity + '",\n' +
      '  "refresh_rate": ' + refreshRate + "\n" +
      "}";
  }

  var lastObjectUrl = null;
  function showRenderError(msg) {
    previewFrame.classList.remove("busy");
    previewFrame.classList.add("errored");
    $("preview-error-text").textContent = msg;
  }

  // The transient render. Builds the scrub ISO from epoch-ms with no offset
  // math — `new Date(ms).toISOString()` is UTC, and the bracketed tz id lets
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
    $("tl-hint").textContent = spanMs() >= dayLen ? "whole day in view; nothing to pan" : "";
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
    loupe.style.backgroundPosition = (lw / 2 - fx * nw) + "px " + (lh / 2 - fy * nh) + "px";
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
