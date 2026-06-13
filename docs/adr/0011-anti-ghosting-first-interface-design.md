# 0011 — Anti-ghosting-first interface design

**Status:** Accepted

## Context

The physical **Device** (TRMNL X) visibly ghosts: static elements held in place across a long
display window leave a faint residual image that shows through the next screen — most painfully when
the chrome-heavy **Transport** board hands off to a clean **Gallery** photo. The residue lands
exactly where value-stable dark pixels sat: the top-left head, the bottom status bar, the full-width
separator line.

Ghosting on e-ink is incomplete particle realignment — residual charge (E Ink's "remnant voltage")
that accumulates while a state is held and decays slowly afterward. Severity scales with **darkness
× area × dwell-time**. This project deliberately maximises the worst factor: the Device is
_inconspicuous decor that changes as rarely as possible_ (battery + unobtrusiveness, see
[vision.md](../vision.md)), so a screen that lands and isn't needed again can dwell for hours. That
is the burn-in regime a single wipe cannot fully clear.

The instinct is to reach for a firmware/server knob. There is none left — verified against the exact
firmware on the Device (`usetrmnl/trmnl-firmware` v1.8.5, the `BOARD_X_CLASS` / FastEPD build, env
`TRMNL_X_dev_no_qa`):

- The Server already sends `temperature_profile: "a"` (`src/conductor/conductor.ts`).
- It **is** read and applied: parsed `"a"→1` (`lib/trmnl/src/parse_response_api_display.cpp`),
  persisted and refreshed from each response (`src/display.cpp:1697-1700`), and consumed at
  `src/display.cpp:1738` —
  `iClearMode = ((iUpdateCount & 7)==0 || (iTempProfile > 0)) ? CLEAR_SLOW : CLEAR_FAST`, then
  `fullUpdate(iClearMode)`. This line lives in the `#else` of `#ifdef BB_EPAPER`; the X _undefines_
  `BB_EPAPER` (because `-D BOARD_X_CLASS`, `platformio.ini`), so it is the live branch — while the
  obvious-looking refresh logic in the `#ifdef BB_EPAPER` block (the `dpList[iTempProfile]`
  panel-type selection, the `maximum_compatibility` handling) is dead code on this hardware. That
  dead branch is why the knob _looks_ unused on a top-to-bottom read.
- `iUpdateCount` is `RTC_DATA_ATTR` (survives deep sleep), so the `& 7` term only fires every 8th
  refresh — it does not mask `temperature_profile`.
- Net: with `"a"`, the X runs `CLEAR_SLOW` (FastEPD: 10 passes black/white/black/white) on **every**
  update, and has **no partial-update path at all** (it is commented out, `src/display.cpp:1731`).
  Every update is already a full grayscale wipe.

The firmware is therefore maxed and the Device still ghosts. The conclusion is forced: **content is
the only remaining lever.**

## Decision

Avoiding ghosting is the **paramount constraint** when designing any **Plugin** view or
**DesignSystem** component for this project — ranked above visual richness, decoration, and
secondary information. The emphasis is _no ghosting at all_, not _less_ ghosting.

Operating rules:

- **Value-per-ghost is the design criterion.** Any element that is value-stable dark and held long
  must justify itself by information value. Zero- or low-value persistent dark content is cut. The
  enemy is solid-dark **area** held long, not blackness per se — small black-on-white text and the
  departure rows (which change as trains roll) are fine.
- **No large solid-dark persistent surfaces, by construction.** The DesignSystem must not be able to
  emit one. The `0.4rem solid #000` StatusBar separator (`templates/ds/chrome/chrome.css`) is
  removed so it cannot creep back.
- **Chrome is minimal and preferably conditional/transient, never
  persistent-for-persistence's-sake.** A datum that only matters sometimes (low battery) surfaces
  only when it matters — ideally as a whole-screen state the panel full-wipes cleanly, not as corner
  chrome that dwells for weeks.
- **Reserve gray/dither for photographic content only.** The Renderer already Floyd-Steinberg
  dithers every screenshot; photos (Gallery) need tone. Chrome never spends gray — it adds dark dots
  for no informational gain.

First application — **Transport** becomes chrome-free: departure rows on white, nothing persistent
except the rows themselves. The head title, the status bar (titles, date, instance, battery), and
the footnote are dropped.

### Considered and rejected

- **Turn up the firmware/server knob** — nothing to turn up; `temperature_profile: "a"` is the
  maximum and already on (verified above).
- **Dither chrome to mid-gray** — the X always does a full grayscale wipe regardless, so gray buys
  no clearing benefit and only adds dark area; the "mid-gray ghosts less than black" claim is also
  unverified in the literature.
- **Render non-photo screens as 1-bit to ride the low-ghost DU waveform** — the DU "low ghosting"
  rating applies to _partial_ B/W updates, which the X never performs; it always `fullUpdate`s.
- **Transition flush frames** (blank the screen on mode switch) — flicker is the firmware's job; if
  the firmware won't, that complexity does not belong in this codebase.

## Consequences

- Transport drops all chrome (`templates/example/transport/root.tsx`, `.../bvg/Board.tsx`). Battery
  is removed from the Device for now; the intended future shape is a full-screen "charge me" state,
  not a persistent corner glyph. `BatteryIndicator` stays in the DesignSystem, unrendered, for that
  later work.
- The DesignSystem StatusBar loses its heavy solid-dark border. `StatusBar` / `BatteryIndicator`
  remain available but are no longer the default furniture of a view.
- This is a posture, not a one-off fix: new Plugins and DS components are evaluated against
  value-per-ghost before they ship. It extends ADR-0008 (which lifted the framework's e-ink physics
  rules — no shadows/gradients/opacity) with a project-specific, stronger stance on persistent dark
  content driven by this Device's long-dwell usage.
- `src/conductor/conductor.ts`'s comment describing `temperature_profile: "a"` as a "4-pass" wipe is
  inaccurate against FastEPD (`CLEAR_SLOW` = 10 passes); worth correcting when that file is next
  touched.
