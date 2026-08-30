# ADR 0011 - E-ink ghosting is not a content constraint

Design Plugin views and DesignSystem components for legibility. Dark area, solid fills and
persistent chrome carry no ghosting cost worth designing around.

No manufacturer source supports a content rule. E Ink rates GC16, the full 16-level update that
drives every pixel through black and white, as its _lowest_-ghosting mode, and its "soft rails"
account has transitions ending at the extremes needing _less_ impulse precision than ones ending in
mid-grey. Pervasive Displays documents the inverse of the folk rule: the pixels that degrade are the
ones a partial update leaves alone, not the ones being driven. Every documented mitigation is a
drive action or a power action, and this firmware already does all of them. It full-updates on every
poll, forces `CLEAR_SLOW` through `temperature_profile: "a"`, and powers the panel down after each
update.

One real asymmetry exists and it is a driver bug, not a design input. FastEPD's grey tables are
hand-authored and not DC-balanced, so each update leaves a residue of uncompensated charge:

    // src/display.cpp, u8_graytable_big (payload > 100 KB, so Gallery photos)
    level  0 (black): 21 black pushes,  0 white  ->  +21 net per update
    level 15 (white): 18 black pushes, 18 white  ->    0 net per update

Do not turn that into "less black". It is not monotonic on the 9-pass table our dashboards actually
use, where mid-grey level 10 costs the same +3 as pure black. It accumulates over years, has no
dwell or area term, does not depend on how often content changes, and no plugin can render around
it. The fix is a corrected matrix upstream in FastEPD.

Refresh at least daily. That is the only rule panel vendors actually state, and any normal cadence
meets it. For a long idle window, vendors say park on white.

Evidence, sources and the firmware read-through are in
[docs/research/ghosting/](../research/ghosting/).

Ruled out:

- Sending `temperature_profile: "b"`. On this hardware the test is `iTempProfile > 0`, so "b" and
  "a" are identical.
- Reserving gray for photographic content. Dither is a legibility choice, not a ghosting mitigation.
