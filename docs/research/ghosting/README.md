# What actually causes e-ink ghosting

Researched 2026-08-30. Motto: **do not assume, verify.** Every claim below cites an ID in
[sources.md](sources.md). Anything without an ID has no source and is marked as such.

Scope: electrophoretic (E Ink) displays, with attention to panels driven at 16 grey levels, and to
the TRMNL X specifically.

Companion files:

- [sources.md](sources.md) - every source, verbatim quotes, classification, retrieval status
- [repo-claims.md](repo-claims.md) - what this repo currently asserts, and which claims survive
- [firmware-verification.md](firmware-verification.md) - every firmware claim checked against source
- [open-questions.md](open-questions.md) - what has no source, and what is still unresolved

---

## The four propositions that were tested

The investigation started from a specific hypothesis: that ghosting is caused by **redrawing the
same content repeatedly** rather than by holding a dark image, and that a pixel already driven to
strong black gets **overcharged** when driven black again.

|        | Claim                                                                                 | Verdict                                                    |
| ------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **P1** | Leaving a black image on an idle screen does not cause ghosting or burn-in            | **Split.** Confirmed for damage, contradicted for ghosting |
| **P2** | Redrawing the same content repeatedly accumulates overcharge                          | **Refuted**                                                |
| **P3** | Strong black means pigment at the capsule top, so redrawing it black risks overcharge | **Refuted as a redraw effect**                             |
| **P4** | The mitigation is varying content, not avoiding strong blacks                         | **Refuted**                                                |

---

## P2 is refuted

Two mechanisms carry this, and they apply to different drive modes. Getting them the right way round
matters, because only one of them applies to the TRMNL X.

### On this device: full updates are compensated and rail-limited

The X does a full update every poll and has no partial path
([firmware-verification.md](firmware-verification.md) §2). Two facts then close the question.

**A pixel cannot be driven past its end state.** E Ink calls this the optical rail [EI-P1]:

> "After a specific impulse has been applied to a pixel of an electro-optic display, that pixel
> cannot get any whiter (or blacker). For example, in an encapsulated electrophoretic display, after
> a specific impulse has been applied, all the electrophoretic particles are forced against one
> another or against the capsule wall, and cannot move further, thus producing a limiting optical
> state or optical rail"

**And the drive is compensated by construction.** The clear phase before every draw is symmetric -
on this device, `CLEAR_SLOW` runs 16 darkening and 16 lightening sweeps
([firmware-verification.md](firmware-verification.md) §5). Pervasive Displays describes the same
design intent and says it is what protects the panel [PDI-3]:

> "Each pixel needs to be compensated (inversed from original image and inversed from new image) and
> reset (full white screen) to keep almost the same moving distance for every particle in the
> capsule of FPL. It helps for improving ghosting effect and extend the lifetime of FPL."

So a pixel that is black this update and black the next is cleared, cycled, and re-driven to the
same rail. Nothing accumulates from the repetition itself. What _does_ accumulate on this device is
the grey table's per-update imbalance, which is indexed by target level only and does not care
whether the pixel changed - see §9 of the firmware write-up.

### In differential modes: same-state pixels are simply not driven

Where a driver does differential updates, an unchanged pixel receives no pulse at all. The author of
the code on the X states it plainly [IMP-1]:

> "For differential updates, the BB and WW sections of the LUT will contain push instructions of 00
> (do nothing) since the color of those pixels is already set to the desired state."

Same in a hand-built DC-balanced epdiy waveform, where black-to-black is `[0,0,0,0]` [IMP-2]. And E
Ink's own two-state illustration puts numbers on it [EI-P1]:

> "black to black - 0 V for 420 msec ... white to white - 0 V for 420 msec. This drive scheme is DC
> balanced, because any series of transitions that brings a pixel back to its initial optical state
> is DC balanced, that is, the net area under the voltage profile for the entire series of
> transitions is zero."

**Do not over-read that table.** It is an illustrative two-optical-state (1-bit) example that the
patent introduces with "For example, one might begin with..." and then uses as a foil. It is not the
patent's invention and it is not a greyscale scheme. It shows that zero-drive same-state transitions
are a normal, DC-balanced design - not that black-to-black is always zero volts. An earlier draft of
this document led with it as if it were a general law; that was wrong, and it was also inconsistent
with the GC16 finding below, where a full greyscale update drives every pixel through black and
white and still ghosts least.

**The word "overcharge" appears in no source consulted** [IMP-NEG]: not in E Ink specs or patents,
not in Pervasive Displays, Good Display or Waveshare documentation, not in bb_epaper, FastEPD,
epdiy, Inkplate, fread-ink, the i.MX EPDC kernel driver, or any lore.kernel.org thread.

### The vendor text says the opposite

Pervasive Displays suspended partial-update support because the pixels that degrade are the ones
**left alone** [PDI-4]:

> "Pixels outside the Partial Update window (i.e. the unchanged pixels) degrade faster over time
> with continued use of this functionality. These unchanged pixels are in an unbalanced/unstable
> state, which impacts the lifespan of the display."

And a full redraw is what **extends** panel life [PDI-3]:

> "Each pixel needs to be compensated (inversed from original image and inversed from new image) and
> reset (full white screen) ... It helps for improving ghosting effect and extend the lifetime of
> FPL."

A peer-reviewed group went further and deliberately **added** drive to same-state transitions,
because leaving them idle was the problem [ACAD-2]:

> "such a scheme will make the next step activation more difficult according to the inactivated
> particles. Therefore, the t_a phase is added to the waveform for W-W."

---

## P3 is refuted as a redraw effect

The physical picture behind P3 is not wrong. Particles do get driven to the extreme, and one E Ink
patent does describe pigment "stuck to the wall membranes of the microcapsules" [EI-P9]. But that
patent is the **only** source found for the adhesion mechanism, with no independent corroboration,
and it attributes the harm to **sitting there**, not to being re-driven.

Two things kill the redraw half of the claim:

1. Extra impulse cannot push a particle past the optical rail. There is no source describing a pixel
   being driven "further" than its end state.
2. E Ink's own mode table rates the black-heavy mode as the **cleanest** [EI-W1]. GC16, the full
   16-level greyscale update that drives pixels through black and white, is rated `Very Low`
   ghosting. GL16 and A2 are rated `Medium`.
3. E Ink says driving to the extremes is the **forgiving** case, not the risky one [EI-P1]:

   > "Because there is a distribution of electrophoretic particle sizes and charges in such a
   > medium, some particles hit the rails before others, creating a \"soft rails\" phenomenon,
   > whereby the impulse precision required is reduced when the final optical state of a transition
   > approaches the extreme black and white states, whereas the optical precision required increases
   > dramatically in transitions ending near the middle of the optical range of the pixel."

   That is the exact inverse of "strong black is the dangerous case". It also independently predicts
   the non-monotonic grey table measured on this device, where a mid-grey costs as much
   uncompensated charge as pure black ([firmware-verification.md](firmware-verification.md) §9).

Driving to full black is the standard **cure**. It is what Pervasive Displays' own de-ghost routine
does [PDI-7]:

```cpp
/// @brief Regenerate the panel
/// @details White-to-black-to-white cycle to reduce ghosting
```

It is also what the TRMNL firmware's own `display_wipe()` does.

**Searched for and not found** [EI-S*] [IC-NEG]: the phrases "strong black", "full saturation",
"saturated black", or any equivalent claim that deep black stresses the panel, across 14 E Ink panel
specs, E Ink's AF Waveform Mode Declaration, nine E Ink patents, all Pervasive Displays datasheets
plus 188 knowledge-base pages plus the Fast Update Application Guide, all Good Display datasheets
and guidelines, the entire Waveshare wiki, and nine controller-IC datasheets. Zero hits.

---

## P4 is refuted

No source recommends varying content as a ghosting mitigation. Every documented mitigation is a
**drive action or a power action**, never a content property:

- Run a full or global update after a run of partial or fast updates [PDI-3] [PDI-6] [GD-1] [GD-3]
  [WS-1] [WS-4]
- Insert a white clearing frame [EI-W1] [GD-1]
- Insert an inverse frame [PDI-3]
- Refresh on a clock [PDI-1] [GD-2] [WS-1]
- Power the panel down between updates [GD-2] [WS-1] [IMP-3]

Where a colour is named it is always **white** - a fixed value, not variation [EI-W1] [GD-1]
[PDI-1].

The one concrete burn-in case found in any tracker came from a **Game of Life animation** [IMP-4]:
content that never repeated. That is P4's prescription producing the outcome P4 promises to avoid.
It is a single community report and should not be over-read, but it is the only concrete instance
located.

---

## P1 splits in two, and the split is the useful part

**No source says a static image damages a panel.** That half of P1 holds.

But four module makers state, in near-identical words, that ghosting or image sticking **may occur**
if a panel is not refreshed within 24 hours [PDI-1] [PDI-2] [GD-4] [SC-1] [WS-2]:

> "If the EPD Panel / Module is not refreshed every 24 hours, a phenomena known as 'Ghosting' or
> 'Image Sticking' may occur. It is recommended that customer refreshed the ESL / EPD Tag every 24
> hours in use case. It is recommended that customer ships or stores the ESL / EPD Tag with a
> completely white image to avoid this issue"

Three things about that clause matter more than the clause itself:

1. **It is about not refreshing.** It says nothing about what the image contains, and it does not
   support "black is worse than white on a live panel". Its colour instruction is mostly about
   **storage** - though note Sinocrystal's variant [SC-1] ends "...every 24 hours in use case **with
   white image**", which is an in-use colour instruction and cuts mildly against a blanket reading.
2. **It is not E Ink's.** Three independent reads of E Ink Holdings panel specifications, 14
   documents including this panel's own class, found the words "ghosting" and "image sticking"
   **zero times**, and no static-image time limit of any kind [EI-S*]. The identical phrasing across
   four module makers looks like shared upstream boilerplate, but no E Ink-authored source for it
   was located. Do not attribute it to E Ink.
3. **The consequence is reversible.** "May occur", remedy is a refresh and parking on white. The
   mono-panel instance [PDI-2] settles an earlier doubt: this is not a colour-panel-only rule.

The mechanism behind it is real and measured, and it is recoverable. E Ink calls it dwell time
dependence [EI-P2]:

> "the impulse necessary for a transition between two specific optical states ... varies with the
> residence time of a pixel in its initial optical state"

Philips measured it and killed it inside a single refresh [ACAD-1]: six 20 ms alternating pulses
before the drive pulse make the resulting white **independent of how long the pixel sat**. That is
what the activation phase in modern waveforms is for. Dwell changes what impulse a pixel needs; it
does not bank damage.

---

## The reframe that matters more than the four propositions

The permanent failure mode documented by E Ink is not an image-shaped scar. It is **whole-panel**
and it is driven by **charge imbalance over years**.

E Ink's own controlled comparison [EI-P4]:

> "The display of the invention exhibited less than half the open-circuit voltage build-up of the
> control display after prolonged driving with the DC-imbalanced waveform."

> "Both displays, when driven with a DC-balanced waveform, exhibited only small changes in the
> measured b* value of the white state" ... "The display of the invention exhibited about one fifth
> of the change in b* of the control display after prolonged driving with the DC-imbalanced
> waveform."

b* is the CIELAB blue-yellow axis, and the quantity measured is the white state's. DC-imbalanced
driving **yellows the white state across the whole module**. The timescale [EI-P3]: "a two year
period after tens of thousands update cycles".

**But be careful how permanent this is.** The same patent says remnant-voltage degradation is
"generally reversible, either by storing the display without further switching or by switching
appropriately to rebalance the DC impulses", and confines irreversible electrode damage to a
**prior-art** display driven at **extreme degrees of DC-imbalance**. An earlier draft of this
document quoted the irreversibility clause with those qualifiers stripped, which made an
acknowledged worst case read as the documented normal failure mode.

So the real hierarchy is:

1. **DC imbalance** - a property of the waveform, not of the content. Accumulates over years. Causes
   module-wide white-point drift, not a visible ghost of a specific image.
2. **Skipping compensation stages** - partial and fast update modes. Causes visible ghosting and,
   per Pervasive Displays, shortens FPL life [PDI-3].
3. **Dwell time dependence** - changes the impulse a pixel needs. Recoverable within one refresh by
   activation pulses [ACAD-1].
4. **Update count** - the panel has a finite budget, stated as 1,000,000 updates or 5 years [DKE-1]
   [WS-3], independent of what colour is drawn. At one refresh per 15 minutes that is roughly 28
   years.

None of these is "you drew too much black".

---

## The conflation to stop repeating

The frightening "cannot be repaired" warnings are about leaving the panel **powered**, not about
leaving an image displayed. These are two different rules with two different mechanisms, and vendors
run them together in the same bullet list.

Good Display's headline reads "Never leave static images displayed" - but the body is a power rule
[GD-2]:

> "When showing unchanged content, set the display to sleep mode or completely power off. Extended
> high voltage can cause irreversible film damage."

Waveshare, same conflation, clearer body [WS-1]:

> "the screen will remain in a high voltage state for a long time, which will damage the e-Paper and
> cannot be repaired!"

The kernel driver author keeps them apart [IMP-3]:

```c
/* Power off the boost regulators. This must be done as soon as the display is
 * updated to avoid burn-in damage if powered on over a long time. */
```

The TRMNL X already calls `einkPower(0)` after every update, so this hazard does not apply to this
device.

---

## What this means for this project

**The content constraints in ADR-0011 have no support in any manufacturer source.** No vendor asks
anyone to avoid solid dark areas, to minimise dark pixel count, or to vary content between renders.
The mitigations vendors actually prescribe are all levers the server and firmware already hold.

What the sources support doing:

- **Refresh at least daily.** Any normal dashboard cadence satisfies the only rule vendors state.
  This is the one real constraint, and it bites for long idle and storage, not for ordinary
  operation. (Daily is the conservative reading: the 24-hour clause is stated flatly by [PDI-1],
  [PDI-2], [SC-1] and [WS-2], while Good Display's guidance page [GD-2] asks 24 hours only of colour
  panels and **once per week** of black-and-white ones.)
- **Keep using full updates.** The firmware already does: the X has no partial path, and
  `temperature_profile: "a"` forces `CLEAR_SLOW`. Full compensated updates are the protective mode
  [PDI-3], not the costly one.
- **Keep powering the panel down between updates.** Already done.
- **Park on white for long idle or storage**, if anything [PDI-1] [GD-1]. Note this points the
  opposite way from the current Sleep plugin, which holds black overnight.

What the sources do **not** support:

- Removing chrome, titles, status bars or battery indicators to reduce dark area
- Treating "avoid ghosting" as a constraint that outranks conveying information
- Believing the panel is "maxed out" and content is the only remaining lever

See [repo-claims.md](repo-claims.md) for the claim-by-claim mapping and what needs rewriting.

---

## Confidence and its limits

Strong: P2 and P4 are refuted from multiple independent directions - manufacturer patents, vendor
application notes, driver implementations, and peer-reviewed waveform research all agree, and none
contradicts. The single strongest and most directly checkable item is [PDI-4], where Pervasive
Displays suspended partial-update support because the _unchanged_ pixels degrade.

Every citation in this document was re-fetched and checked by an independent read-only agent. It
confirmed the sources are real and the classifications honest, and it caught two misquotes and one
scope error, all corrected above: the b* comparison in [EI-P4], the stripped qualifiers on that
patent's irreversibility clause, and the promotion of [EI-P1]'s two-state illustration into a
general law. That agent could not reach `patents.google.com` and read the patents through a
text-extraction proxy. Every patent quote here has since been **re-fetched directly from
`patents.google.com` and confirmed at source**, together with the surrounding context that
establishes its scope. That pass turned up two further inexactnesses, both fixed: the optical-rail
quote was missing a clause, and the DTD quote had lost its "at least in some cases" hedge.

Weaker: the **physics behind the 24-hour rule**. The rule itself is verbatim vendor text across four
module makers. Its mechanism is not well established. E Ink publishes no dwell limit, the adhesion
mechanism rests on one patent [EI-P9], and an OpenAlex search for electrophoretic "image sticking"
returns zero peer-reviewed works [ACAD-4]. The recommendation is solid; the explanation for it is
thin. Do not build a physics argument on it.

Verified and device-specific: FastEPD's hand-authored greyscale tables are **not** DC-balanced, and
the two darkest levels are the only rows with no compensating white pushes at all - +21 net per
update on the photo table, against 0 for white. Computed directly from the shipped source; see
[firmware-verification.md](firmware-verification.md) §9.

This is the one finding that partially rehabilitates a concern about dark content on **this**
device. It is not the mechanism proposed in P2 or P3: it has no dwell term, no area term, and no
dependence on redraw count. It is a property of the driver's lookup table, its timescale is years,
and the fix belongs upstream in FastEPD rather than in plugin design.
