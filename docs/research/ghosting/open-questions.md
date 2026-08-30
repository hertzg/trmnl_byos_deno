# What has no source, and what is still open

Companion to [README.md](README.md). Recorded so nobody re-derives these from scratch or fills them
in with plausible reasoning.

## Searched for, not found

Each of these was actively hunted across manufacturer specs, patents, application notes, driver
source and peer-reviewed literature. **Absence here is a finding, not a gap in effort.**

1. **Any statement, anywhere, that repeatedly driving a pixel to the same state harms it.** Zero
   hits. Pervasive Displays documents the converse [PDI-4]: it is the _unchanged_ pixels that
   degrade.

2. **The word "overcharge", in any e-ink context.** Not in E Ink specs or patents, Pervasive
   Displays, Good Display, Waveshare, bb_epaper, FastEPD, epdiy, Inkplate, fread-ink,
   `mxc_epdc_fb.c`, `repaper.c`, or lore.kernel.org. Pervasive Displays' "overdriven in an
   unbalanced state" [PDI-3] refers to _missing compensation stages_, not to the target colour.

3. **"Strong black", "full saturation", or any claim that deep black stresses the panel.** Zero hits
   across 14 E Ink panel specs, the AF Waveform Mode Declaration, nine E Ink patents, all Pervasive
   Displays / Good Display / Waveshare documentation, and nine controller-IC datasheets.

4. **Any vendor recommendation to vary content as a ghosting mitigation.** Zero hits. Every
   documented mitigation is a drive action or a power action.

5. **Any E Ink Holdings statement of a maximum static-image time.** Zero hits across 14 panel specs,
   including this panel's own class, confirmed by three independent reads. The 24-hour rule is
   module-maker text only. **Do not attribute it to E Ink.**

6. **A quantitative DC-imbalance threshold.** No coulombs, no volt-seconds, no cycles-to-failure at
   a stated imbalance, in any source. E Ink demonstrates _relative_ improvement [EI-P4] but
   publishes no absolute limit.

7. **A clean vendor taxonomy separating recoverable ghosting from permanent image sticking.**
   Pervasive Displays, Good Display and Sinocrystal use the two terms as synonyms in the same
   sentence. E Ink never uses "image sticking" at all. The recoverable/permanent distinction is
   ours, not theirs.

8. **Peer-reviewed work on permanent EPD image sticking.** An OpenAlex title-and-abstract search for
   `electrophoretic AND "image sticking"` returns zero results [ACAD-4].

9. **Independent corroboration for the pigment-adhesion mechanism.** [EI-P9] is the only source
   describing particles "stuck to the wall membranes of the microcapsules". Single-source.

10. **Any DC-balance requirement or "wrong LUT damages the panel" warning in a controller-IC
    datasheet.** The string "balanc" appears in none of the nine IC documents read.

11. **A partial-refresh count limit in any datasheet** (as opposed to an app note or FAQ). Good
    Display's "5" lives only in guidelines and FAQ pages; Waveshare's general rule is always
    "several times"; no IC datasheet states any ceiling.

## Contradictions left standing

- **Pervasive Displays contradicts itself on the fast-update ceiling**: 20 in the knowledge base
  [PDI-6], 50-100 in the November 2025 application guide [PDI-3]. Unresolved. Both are their own
  text.
- **FastEPD's header comments contradict its implementation.** `FastEPD.h:41-42` says CLEAR_FAST is
  "8 passes" and CLEAR_SLOW "10 passes"; `FastEPD.inl:2102-2111` implements 2 and 4 phases of 8
  sweeps each. See [firmware-verification.md](firmware-verification.md) §5. The implementation wins.

## Sources whose URL could not be independently re-fetched

Wording reported verbatim, retrieval path imperfect. Flagged UNVERIFIED-URL in
[sources.md](sources.md):

- **Pervasive Displays datasheets** - the vendor rebuilt their site and every
  `wp-content/uploads/*.pdf` now 404s. Quotes come from Internet Archive snapshots of
  vendor-authored PDFs.
- **Pervasive Displays Fast update Application Guide PDW001 Rev.02** - download-gated, no stable
  public URL. This is the source of the strongest single quote in the investigation (that full
  redraws _extend_ FPL life), so its gated status matters.
- **Good Display CDN** - 403s without a `Referer` header.
- **ITE IT8951 documentation** - NDA-gated; copies read were reseller mirrors stamped CONFIDENTIAL.
- **Solomon Systech SSD168x** - no vendor download page; distributor mirrors only.

## Genuinely open, worth resolving

1. **Is the unbalanced grey table actually causing anything observable?**
   [firmware-verification.md](firmware-verification.md) §9 establishes the imbalance exists and that
   black is the worst case (+21 uncompensated per update on the photo table, versus 0 for white). It
   does **not** establish that this explains the ghosting observed over hours. The arithmetic says
   it should take years. Something else explains the short-term residue.

2. **What did the original observation actually see?** ADR-0011:7-11 reports Transport chrome
   ghosting into Gallery photos. Nothing in the research explains hour-scale residue on a panel that
   does a 32-sweep balanced clear before every draw. Candidate explanations not yet tested: the
   9-pass table's own weakness at high-contrast edges; the payload-size threshold switching tables
   between screens (a dashboard uses the 9-pass table, a photo the 38-pass one, so a handoff between
   them changes the drive scheme mid-sequence); or simply that the residue was real but transient
   and would have cleared on the next update.

   **The table-switching hypothesis is new, testable, and nobody has looked at it.** It is a much
   better fit for "most painfully when the chrome-heavy Transport board hands off to a clean Gallery
   photo" than anything about dark area.

3. **Does `display_wipe()` actually clear the user's deep ghost?** Untested. It is 3,200 balanced
   full-panel sweeps in 1-bpp. It is uniform, so the earlier reasoning that a uniform stimulus
   cannot null a patterned remnant state may still hold.

4. **Panel part number.** Never resolved. TRMNL markets the X as 13.3-inch; the firmware geometry is
   1872x1404. Those are not obviously the same panel. Until the actual part is identified,
   panel-specific datasheet claims cannot be checked against _this_ panel.

5. **The Sleep screen experiment named in ADR-0011:79-80 was never run.** It is now much less
   interesting than it was - the dwell-versus-drive question is answered by [EI-P1] and [ACAD-1]
   - but a night of black held with zero refreshes is still free evidence, and the vendor guidance
     to park on white for long idle [PDI-1] [GD-1] points the other way from what the Sleep plugin
     currently does.
