# Firmware cross-check - what is actually true on this Device

Verified 2026-08-30 by reading source, not summaries.

**Firmware checkout:** `usetrmnl/trmnl-firmware` at `74f7b18`, `git describe` =
`v1.8.8-82-g74f7b18`, branch `main`, working tree clean apart from untracked scratch dirs.

**FastEPD is available locally** at `.pio/libdeps/TRMNL_X/FastEPD/`. `env:TRMNL_X` pins it to commit
`855ce9a4` (`platformio.ini:497`), and the vendored tree reports `version=1.5.2` in
`library.properties`. The `1.4.6.zip` pin belongs to `env:TRMNL_X_EPDIY` and
`env:TRMNL_X_SENSORIAC5`, not to the main X build. Everything below is read from the 1.5.2 tree.

Earlier notes in this repo said the pass counts were "unverifiable from these checkouts". That was
wrong - the library is right there.

Everything here is `file:line` from those two trees. Where a claim in our docs turned out to be
wrong, the correction is stated flat.

Every claim below was re-checked by an independent read-only agent that recomputed §9's arithmetic
from source. It confirmed all 32 net-charge figures and every preprocessor-context finding, and
caught six errors in the first draft (FastEPD version, the `BB_EPAPER` justification, two line
numbers, one summary row, and an overstated headline). Those are fixed here.

---

## 1. The X runs the FastEPD branch. Confirmed.

`platformio.ini` for every X env (lines 289, 326, 363, 401, 439, 479, 524, 560, 600) carries
`-D BOARD_X_CLASS`, pulls FastEPD, and sets:

```
lib_ignore = bb_epaper
```

`BB_EPAPER` is defined in `src/display.cpp:20`, and the define is itself guarded:

```c
#ifndef BOARD_X_CLASS
#define BB_EPAPER
#include "bb_epaper.h"
```

Since every X env sets `-D BOARD_X_CLASS`, the define never happens on the X. So `#ifdef
BB_EPAPER`
is false there and every `#else` branch is the live one. (The `bb_epaper` library header defines
`__BB_EPAPER__`, a different symbol, and is excluded from the X build anyway.)

Verified mechanically by walking the preprocessor stack over `src/display.cpp`:

| Line | Code                                                                   | Preprocessor context       | Live on X? |
| ---- | ---------------------------------------------------------------------- | -------------------------- | ---------- |
| 151  | `bCanDoPartial = (bbep.getPanelType() == dpList[iTempProfile].OneBit)` | `ifdef BB_EPAPER`          | **dead**   |
| 172  | `bbep.setPanelType(dpList[iTempProfile].OneBit)`                       | `ifdef BB_EPAPER`          | **dead**   |
| 501  | `bbep.setPanelType(dpList[iTempProfile].OneBit)`                       | `ifdef BB_EPAPER`          | **dead**   |
| 1651 | `bbep.setPanelType(dpList[iTempProfile].OneBit)`                       | `ifdef BB_EPAPER`          | **dead**   |
| 1677 | `bbep.setPanelType(dpList[iTempProfile].TwoBit)`                       | `ifdef BB_EPAPER`          | **dead**   |
| 1760 | `i426Workaround` panel check                                           | `ifdef BB_EPAPER`          | **dead**   |
| 1839 | `if (iTempProfile != ...response.temp_profile)`                        | none                       | **live**   |
| 1906 | the `CLEAR_SLOW : CLEAR_FAST` selector                                 | `ELSE-OF(ifdef BB_EPAPER)` | **live**   |

**ADR-0011's dead-code analysis is correct.** Every `dpList[iTempProfile]` use, including the
panel-type selection and the `maximum_compatibility` handling, is inside the BB_EPAPER branch and
does not run on this device.

## 2. The X never does a partial update. Confirmed.

`src/display.cpp:1897-1901`, in the live branch, commented out:

```c
//   if (bbep.getPreviousMode() != BB_MODE_NONE && (bbep.getMode() == BB_MODE_1BPP || bbep.getMode() == BB_MODE_2BPP)) {
//       Log_info("... Using partial update since we have a copy of the previous image\n" ...);
//       bbep.setPasses(6,6);
//       bbep.partialUpdate(false);
//   } else {
```

Every content update on the X is a full, flashing update. This matters more than it looks: the
partial and fast modes are the ones vendors actually warn about (see [sources.md](sources.md)
[PDI-3], [PDI-4]). This device does not use them.

## 3. `temperature_profile` has exactly one effect on the X, and "b" is not stronger than "a"

`lib/trmnl/src/parse_response_api_display.cpp:34-40`:

```c
  String tp = doc["temperature_profile"];
  uint32_t u32TP = 0; // default
  if (tp == "a")
    u32TP = 1;
  else if (tp == "b")
    u32TP = 2;
//     else if (tp == "c") u32TP = 3;
```

`src/display.cpp:1905-1906`, the only live consumer on the X:

```c
int iClearMode = bSkipClear ? CLEAR_NONE
                           : ((iUpdateCount & 7) == 0 || (iTempProfile > 0)) ? CLEAR_SLOW : CLEAR_FAST;
```

The test is `iTempProfile > 0`. **"a" (1), "b" (2) and "c" (3) are indistinguishable on this
hardware.** All three force `CLEAR_SLOW`; "c" is commented out of the parser anyway.

This **resolves** the doubt raised in the audit about whether `"b"` was an unused stronger setting.
It is not. ADR-0011's "there is no knob left" is correct as far as `temperature_profile` goes.

`src/display.cpp:1839-1842` (unguarded, so live on X) writes the value to flash via
`preferences.putUInt`, so the setting is **sticky across reboots** until the server sends a
different one.

## 4. The panel is powered down after every update. Confirmed.

`src/display.cpp:1908`: `bbep.fullUpdate(iClearMode, false)` - the second argument is `bKeepOn`
(signature at `FastEPD.h:258`).

`FastEPD.inl:2371`, at the end of `bbepFullUpdate`, which is the function the X actually calls (the
same line exists at `:2082` in `bbepFastUpdate`):

```c
if (!bKeepOn) bbepEinkPower(pState, 0);
```

So the "leaving the panel powered damages the film" hazard that Good Display and Waveshare warn
about ([GD-2], [WS-1]) **does not apply to this device**. The firmware already does the right thing.

## 5. The pass-count dispute is settled, and our ADR "correction" was the wrong one

`FastEPD.h:41-42` header comments:

```c
CLEAR_FAST, // 8 passes black/white
CLEAR_SLOW, // 10 passes black/white/black/white
```

`FastEPD.inl:2102-2111`, the actual implementation:

```c
case CLEAR_SLOW:
    bbepClear(pState, BB_CLEAR_DARKEN, 8, pRect);
    bbepClear(pState, BB_CLEAR_LIGHTEN, 8, pRect);
    bbepClear(pState, BB_CLEAR_DARKEN, 8, pRect);
    bbepClear(pState, BB_CLEAR_LIGHTEN, 8, pRect);
    break;
case CLEAR_FAST:
    bbepClear(pState, BB_CLEAR_DARKEN, 8, pRect);
    bbepClear(pState, BB_CLEAR_LIGHTEN, 8, pRect);
    break;
```

So:

- `CLEAR_SLOW` = **4 phases**, black/white/black/white, **8 sweeps each = 32 sweeps**
- `CLEAR_FAST` = **2 phases**, black/white, **8 sweeps each = 16 sweeps**

**`server/src/conductor/conductor.ts:169` was right, on the reading it intends.** Its "4-pass
B/W/B/W vs CLEAR_FAST's 2-pass" is correct if "pass" means _phase_, and the 2:1 ratio is right
either way.

Be aware the surrounding library uses "pass" differently. FastEPD's own loops call one full-screen
sweep a pass (`for (pass = 0; pass < iPasses; pass++)`, `FastEPD.inl:2320`), and
`display.cpp:1887/1893` names the matrices "38-pass"/"9-pass" on that basis. In library terminology
`CLEAR_SLOW` is **32 passes** and `CLEAR_FAST` is **16**. So the honest scorecard is: the header
comment (8/10) matches nothing, `conductor.ts` (4/2) is right on phases and on ratio, and ADR-0011's
"10" is right on neither.

**ADR-0011:107-109 was wrong** to "correct" it to 10 passes. That figure comes from the stale header
comment in `FastEPD.h`, which does not match the implementation below it. The recommendation in the
ADR to "correct" `conductor.ts` should be dropped, not applied.

Both clear modes are **charge-balanced by construction**: equal darken and lighten sweeps.

## 6. `display_wipe()` on the X is 100 iterations, not 60

`src/display.cpp:491-515`. The `#else` (live on X) branch:

```c
bbep.setMode(BB_MODE_1BPP);
bbep.fillScreen(BBEP_WHITE);
for (int i=0; i<100; i++) { // 200 black/white cycles should remove any ghosting
    bbep.fullUpdate(CLEAR_SLOW, true);
}
bbep.einkPower(0); // power off the display
```

The `refreshCount = 60` / "2 to 3 minutes" figures are in the `#ifdef BB_EPAPER` branch, which is
the OG/Gen2 path and **does not run on the X**. Any statement that the X does 60 refreshes is wrong.

Real cost on the X: 100 iterations x 32 clear sweeps = **3,200 full-panel sweeps**, plus the 1-bpp
draw each time. It is charge-balanced throughout (equal darken and lighten), so it is not harmful,
but it is long.

## 7. `screen_wiper.png` exists and behaves as documented

`src/bl.cpp:1541-1556`:

```c
https_request_err_e result = handleApiDisplayResponse(apiDisplayResult.response);
if (apiDisplayResult.response.filename == "screen_wiper.png") {
    // Guard against re-fetching forever if the wiper is the only playlist item
    static bool wiped_this_wake = false;
    if (wiped_this_wake) {
        Log_info("Screen wiper returned again; not wiping twice in one wake");
        return result; // leave the wiped (white) screen as-is
    }
    wiped_this_wake = true;
    ...
    display_wipe();
    ...
    return downloadAndShow();
}
```

Exact string match on `filename`, fires before any image download, one wipe per wake, immediate
re-poll afterwards. The server must return a **different** filename on the re-poll or the device
sleeps on a blank white screen. This lever exists and our server does not use it.

## 8. The X renders at 16 grey levels, so the greyscale research applies

`src/display.cpp:1696-1707`, live branch:

```c
switch (png->getBpp()) {
    case 1:
        bbep.setMode(BB_MODE_1BPP);
    break;
    case 2:
        // 2-bit PNGs are expanded to 4bpp in png_draw() so refresh uses u8_graytable
        bbep.setMode(BB_MODE_4BPP);
    break;
    default:
        bbep.setMode(BB_MODE_4BPP);
    break;
}
```

`BB_MODE_4BPP` is 16 grey levels. `BB_MODE_1BPP` is used for message screens (`display.cpp:1973`,
`:2495`, `:2604`), the boot path, `display_wipe()`, and - note this one - any content PNG that is
genuinely 1 bpp (`display.cpp:1698`), which would bypass the grey tables entirely.

Our Renderer emits 4-bit dithered PNGs (`server/src/render/profiles.ts:14-18`, `bitDepth: 4`), so
content updates take the **4BPP** path and do hit the grey tables.

---

## 9. The finding that matters: the X's grey tables are not DC-balanced

This is new, it is device-specific, and it is the one result that partially rehabilitates a concern
about dark content - though not for any of the reasons originally proposed.

`src/display.cpp:1885-1895` selects one of two hand-authored matrices by payload size:

```c
if (data_size > FASTEPD_LARGE_IMAGE_THRESHOLD) {   // 100 * 1024
  int rc = bbep.setCustomMatrix(u8_graytable_big, sizeof(u8_graytable_big));
  Log_info("using 38-pass gray table (data_size=%d)", data_size);
} else {
  int rc = bbep.setCustomMatrix(u8_graytable, sizeof(u8_graytable));
  Log_info("using 9-pass gray table (data_size=%d)", data_size);
}
```

The matrices are at `src/display.cpp:77-113`. Each is 16 rows (one per grey level) of per-pass push
codes.

The codes are unambiguous. `FastEPD.inl:1872-1875`:

```c
if (val == BB_CLEAR_LIGHTEN) val = 0xaa;      // 0b10 per pixel -> push white
else if (val == BB_CLEAR_DARKEN) val = 0x55;  // 0b01 per pixel -> push black
else if (val == BB_CLEAR_NEUTRAL) val = 0x00; // do nothing
```

So in the tables: **1 = push black, 2 = push white, 0 = do nothing.** Both clear and draw loops use
the same `delayMicroseconds(230)` per pass and the same drive rails, so counting pushes is a fair
proxy for net charge.

Net charge per pixel per update, computed directly from the shipped tables:

The selector is **payload size**, not content type. The names below describe what tends to land on
each side of the threshold, not a rule the code enforces.

### 9-pass table (payloads under 100 KB)

| Level          | push black | push white | net    |
| -------------- | ---------- | ---------- | ------ |
| **0 (black)**  | 3          | 0          | **+3** |
| 1              | 5          | 2          | +3     |
| 3              | 6          | 3          | +3     |
| 10             | 6          | 3          | +3     |
| 12             | 3          | 3          | 0      |
| 14             | 3          | 5          | -2     |
| **15 (white)** | 0          | 1          | **-1** |

Mean across all 16 levels: **+1.12**

### 38-pass table (payloads over 100 KB)

| Level          | push black | push white | net     |
| -------------- | ---------- | ---------- | ------- |
| **0 (black)**  | 21         | **0**      | **+21** |
| **1**          | 16         | **0**      | **+16** |
| 2              | 22         | 13         | +9      |
| 3              | 17         | 13         | +4      |
| 4              | 19         | 15         | +4      |
| 9              | 18         | 14         | +4      |
| 5-8, 10-14     | 10-17      | 9-16       | +1 each |
| **15 (white)** | 18         | 18         | **0**   |

Mean across all 16 levels: **+4.19**

### What this means

The clear phase is balanced. The draw phase is not. So each full update leaves a per-pixel net
charge equal to that pixel's table row.

On the 38-pass table, a **pure black pixel takes +21 net darkening charge every single update and
receives no compensating white push at all**, while a pure white pixel nets exactly zero. Levels 0
and 1 are the only rows there with zero white pushes.

**This does not generalise to "darker is worse".** On the 9-pass table the profile is not monotonic:
level 0 is +3, but so are levels 1, 3 and **10** (a mid-grey), while level 5 is -1 and level 13 is
-1. Mid-grey carries exactly as much uncompensated charge as pure black there. The clean "black is
the worst case" reading holds only on the 38-pass table. Anyone tempted to derive a design rule from
this should stop at that sentence.

Physically: the clear cycles the pixel black/white/black/white and ends white, netting zero. The
draw then pushes it back to black with 21 uncompensated darkening pushes. The pixel ends where it
started optically, but the charge does not cancel. Repeat that every refresh and it is exactly the
DC imbalance E Ink attributes to multi-year electrode degradation and white-point drift ([EI-P3],
[EI-P4]).

FastEPD's own author flags the risk in the neighbouring code path, `FastEPD.inl:2158`:

```c
// N.B. to maintain a balance of charge, be careful with the 'push all' mode
```

and, on his wiki [IMP-1], judges it survivable: _"a charge imbalance is usually not a fatal
situation for the display."_

### How this relates to the original hypothesis

It does **not** support the "redrawing the same pixel overcharges it" story. The imbalance is
per-update and identical whether the pixel was black last time or white - the table is indexed by
target level only, from a cleared white state. Redraw count and content-change rate are irrelevant
to it.

It **does** mean that on this specific device, with this specific hand-tuned table, dark pixels
carry more uncompensated charge per update than light ones. Not because the pigment is "at the top",
and not from repetition. Because the driver author wrote a from-white table that does not balance
the darkest two levels.

Scale, honestly: at one refresh per 15 minutes, a pixel that is pure black in every photo for a year
accumulates roughly 35,000 updates x 21 = 735,000 uncompensated push-slots. E Ink's own degradation
timescale is "a two year period after tens of thousands update cycles" [EI-P3]. So this is the right
order of magnitude to matter eventually, and nowhere near enough to explain ghosting observed over
hours.

**It is a driver issue, not something a plugin author can render around** - and the mitigation, if
one is ever wanted, is a corrected matrix upstream in FastEPD, not less black in the design.

### Which table do our payloads actually hit?

Measured, by rendering every debug pattern through the real Renderer profile (`trmnl-x`, 1872x1404,
4-bit, Floyd-Steinberg) and comparing against the 100 KB threshold:

```
wedge          6.7 KB -> 9-pass      ghosting       10.4 KB -> 9-pass
ramp         173.5 KB -> 38-pass     text-density    9.3 KB -> 9-pass
checker        4.0 KB -> 9-pass      noise           5.3 KB -> 9-pass
frame          6.9 KB -> 9-pass      black           1.3 KB -> 9-pass
grid          12.4 KB -> 9-pass      white           3.9 KB -> 9-pass
fine-lines     8.7 KB -> 9-pass      palette         8.1 KB -> 9-pass
diagonal       6.8 KB -> 9-pass
```

Flat graphic content lands far under the threshold even after dithering. Only `ramp`, a full-screen
continuous gradient and the closest synthetic stand-in for a photo, crosses it. So the firmware
author's intent does hold in practice: **dashboards take the 9-pass table, Gallery photos take the
38-pass one.** A dashboard carrying a large dithered photo region would cross over.

### The 1-bpp path is unbalanced too

Not part of the original claim, but worth recording: with a clear mode active the 1BPP draw path
selects `LUTB_16` ("push black only", `FastEPD.inl:2266`) and runs `iFullPasses` times with no white
pushes at all. So message screens have the same asymmetry. `display_wipe()` is exempt in practice -
it fills white first, so there are no black pixels for those passes to push, and only the 32
balanced clear sweeps do any work.

---

## Corrections this forces in our own repo

| Where                     | Current text                                                | Verdict                                                                                                                           |
| ------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `conductor.ts:169`        | "4-pass B/W/B/W ghost-erase vs CLEAR_FAST's 2-pass"         | **Correct.** Leave it.                                                                                                            |
| `ADR-0011:107-109`        | "is inaccurate ... `CLEAR_SLOW` = 10 passes"                | **Wrong.** Remove; it trusts a stale header comment over the implementation.                                                      |
| `ADR-0011:13-15`          | "severity scales with darkness x area x dwell-time"         | **No source.** See [README.md](README.md).                                                                                        |
| `ADR-0011:72-81`          | "Open question - dwell vs. drive"                           | **Answerable now.** Neither: same-state redraw is 0 V, and dwell is recoverable. The real asymmetry is the unbalanced grey table. |
| `ADR-0011:85-86`          | "`temperature_profile: "a"` is the maximum and already on"  | **Correct**, and now proven: `"b"` is identical on X.                                                                             |
| `ADR-0011:90-91`          | "the X never performs [partial updates]"                    | **Correct.** Verified commented out.                                                                                              |
| `ADR-0011` "no knob left" | conclusion                                                  | **Wrong.** `screen_wiper.png` (§7) is a live, unused server lever.                                                                |
| `patterns.ts:69-72`       | "ghosting stress ... makes partial-refresh residue visible" | **Misleading.** The X does no partial refresh.                                                                                    |
