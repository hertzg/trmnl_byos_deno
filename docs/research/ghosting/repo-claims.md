# What this repo asserts, and whether it survived

Inventory taken 2026-08-30 across this repo and `usetrmnl/trmnl-firmware`. Verdicts come from
[README.md](README.md) (manufacturer evidence) and
[firmware-verification.md](firmware-verification.md) (source reading).

Almost the entire e-ink physics story in this repo lives in one document,
`docs/adr/0011-anti-ghosting-first-interface-design.md`, with restatements in `CONTEXT.md`,
`plugins/transport/root.tsx`, and `server/src/conductor/conductor.ts`.

**Nothing in either repo cites a single external physics source.** The only external citations
anywhere are to firmware code and to `usetrmnl/trmnl-firmware#357` - citations for _what the code
does_, never for _how the physics works_.

## Claims that did not survive

| Location             | Claim                                                                                                                                                             | Verdict                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-0011:13-15`     | "Ghosting ... residual charge (E Ink's 'remnant voltage') that accumulates while a state is held ... Severity scales with **darkness x area x dwell-time**."      | **Unsupported.** No source states a darkness or area term. The dwell term exists as E Ink's dwell time dependence [EI-P2] but is recoverable within one refresh [ACAD-1], not accumulating.                      |
| `CONTEXT.md:161-162` | Same severity model, promoted to project vocabulary                                                                                                               | **Unsupported.** Same as above, and worse for being canonical.                                                                                                                                                   |
| `CONTEXT.md:164-165` | "_Avoid_: burn-in (implies permanence; e-ink ghosting is not permanent)"                                                                                          | **Overstated.** DC-imbalanced driving does cause irreversible electrode degradation [EI-P4]. Rare and slow, but real. Also self-contradicted at `ADR-0011:18` and `root.tsx:19`, which both use the banned term. |
| `ADR-0011:45-47`     | "Avoiding ghosting is the **paramount constraint** ... ranked above visual richness, decoration, and secondary information. The emphasis is _no ghosting at all_" | **Collapses.** Rests entirely on the severity model above. No manufacturer source asks anyone to constrain content.                                                                                              |
| `ADR-0011:52-54`     | "The enemy is solid-dark **area** held long, not blackness per se"                                                                                                | **Unsupported.** No area term in any source.                                                                                                                                                                     |
| `ADR-0011:62-64`     | "Reserve gray/dither for photographic content only ... it adds dark dots for no informational gain"                                                               | **Unsupported as physics.** Fine as an aesthetic rule; it is not a ghosting mitigation.                                                                                                                          |
| `ADR-0011:87-89`     | "the 'mid-gray ghosts less than black' claim is also unverified in the literature"                                                                                | **Ironic but roughly right.** No source supports mid-gray being safer. Note the ADR asserts absence of literature without naming any literature searched.                                                        |
| `ADR-0011:90-91`     | "the DU 'low ghosting' rating applies to _partial_ B/W updates"                                                                                                   | **Wrong emphasis.** E Ink's own table [EI-W1] rates **GC16 `Very Low`**, below DU's `Low`. The full greyscale mode is the cleanest, which undercuts the whole "less ink is safer" framing.                       |
| `ADR-0011:107-109`   | "`conductor.ts`'s ... '4-pass' wipe is inaccurate against FastEPD (`CLEAR_SLOW` = 10 passes)"                                                                     | **Wrong.** The implementation is 4 phases. See [firmware-verification.md](firmware-verification.md) §5. The `conductor.ts` comment was right; this correction trusts a stale header comment. Do not apply it.    |
| `ADR-0011:40-41`     | "The firmware is therefore maxed and the Device still ghosts ... content is the only lever"                                                                       | **Wrong.** `screen_wiper.png` is a live, unused server lever (§7). Also the conclusion does not follow even if the premise held.                                                                                 |
| `root.tsx:16-19`     | "value-stable dark pixels held for hours ghost into the next screen ... nothing static burns in"                                                                  | **Unsupported.** Inherits the severity model.                                                                                                                                                                    |
| `patterns.ts:69-72`  | "ghosting stress ... makes partial-refresh residue visible"                                                                                                       | **Misleading.** The X performs no partial refresh (§2). The pattern cannot test what it claims.                                                                                                                  |

## Claims that survived

| Location               | Claim                                                                                                                         | Verdict                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-0011:20-35`       | The whole "no knob left" firmware verification: BB_EPAPER dead on X, `dpList` dead, `& 7` does not mask `temperature_profile` | **Correct**, and now re-verified mechanically at `74f7b18`. Line numbers have drifted; the analysis has not.                                                                 |
| `ADR-0011:85-86`       | "`temperature_profile: "a"` is the maximum and already on"                                                                    | **Correct, and now proven stronger than claimed**: `"b"` is byte-for-byte identical in effect on the X, because the test is `iTempProfile > 0`.                              |
| `ADR-0011:90-91`       | "the X never performs [partial updates]; it always `fullUpdate`s"                                                             | **Correct.** Verified commented out at `display.cpp:1897-1901`.                                                                                                              |
| `conductor.ts:169-176` | `"a"` forces CLEAR_SLOW; 4-pass vs 2-pass; `maximum_compatibility` ignored on FastEPD                                         | **All four sub-claims correct.** The one flagged as wrong by ADR-0011 is the one that was right.                                                                             |
| `ADR-0004`             | Identity-keyed cache; skipping repaints saves flicker and battery                                                             | **Unaffected**, and quietly vindicated: fewer updates means fewer uncompensated charge injections (§9) and a slower burn of the 1,000,000-update budget [DKE-1].             |
| `ADR-0008:100`         | "no shadows, gradients, or opacity; `image-dither` on photos only"                                                            | **Fine as inherited design rules.** But they are dither-legibility rules, not ghosting physics. ADR-0011 framing itself as an extension of _physics_ guidance does not hold. |

## Decisions that need revisiting

Ranked by how much they cost.

1. **Transport is chrome-free** (`ADR-0011:66-68`, implemented `root.tsx`). Title, date, instance
   label, footnote and battery were removed to reduce dark area. No source supports the reason. The
   components still exist; this is cheap to reverse.

2. **Battery removed from the Device** (`ADR-0011:97-100`). A battery-powered device with no battery
   indicator, and the planned full-screen replacement was never built. Same unsupported premise.

3. **The DesignSystem StatusBar separator deleted "by construction"** (`ADR-0011:55-57`,
   `ds/chrome/chrome.css`). A capability was removed, not just discouraged, on an unsupported
   premise. The "by construction" framing makes it the hardest to walk back.

4. **`CONTEXT.md:161-165` glossary entry.** The severity model is project vocabulary. Until it is
   rewritten, every future design conversation inherits the error.

5. **The Sleep plugin holds black for ~8 hours** (`CONTEXT.md:144`). Left in place deliberately as
   ADR-0011's own unrun experiment. The research says same-state redraw is harmless and dwell is
   recoverable, so the black screen is very likely fine - but vendor guidance for long idle points
   at **white** [PDI-1] [GD-1], and this is the one place that guidance actually bites.

6. **`patterns.ts` "ghosting" test pattern.** Cheap to fix: relabel or remove. It currently claims
   to reveal something this device cannot produce.

## The thing that is actually true about dark content on this device

Not what ADR-0011 says, but not nothing either.

The X's grey tables are hand-authored and **not DC-balanced**, and the two darkest levels are the
only rows with zero compensating white pushes: **+21 net per update on the photo table, versus 0 for
white**. Full detail in [firmware-verification.md](firmware-verification.md) §9.

This is a real, measured, device-specific asymmetry that does make dark pixels cost more charge than
light ones. It is **not** the mechanism ADR-0011 describes: it has no dwell term, no area term, and
no dependence on redraw count or content stability. It is a property of the driver's lookup table,
and the fix belongs upstream in FastEPD, not in plugin design.

Its timescale is years, per E Ink's own degradation figures [EI-P3]. It does not explain hour-scale
ghosting. See [open-questions.md](open-questions.md) §2 for what might.
