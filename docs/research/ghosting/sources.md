# Source register - e-ink ghosting

Every source consulted, with the verbatim text a claim rests on. Retrieved 2026-08-30.

Claims in [README.md](README.md) cite these IDs. If a claim here has no ID, it has no source and
must not be repeated.

## The documents are archived here

Every primary document below is stored in [sources/](sources/), with SHA-256 hashes and retrieval
URLs in [sources/MANIFEST.md](sources/MANIFEST.md). This is not belt-and-braces: Pervasive Displays
rebuilt their site and every datasheet URL 404s, `docs.pervasivedisplays.com` times out from a plain
client, mdpi.com serves a CAPTCHA, and lore.kernel.org blocks automated fetches outright. Citations
alone would already have rotted.

Patent PDFs are largely scanned images, so `sources/text/` holds greppable full text for each one.
All 16 patent quotes used below were re-confirmed against those local files on 2026-08-30.

Three items could not be archived and are listed in the manifest. The only one carrying a quote in
this file is [IMP-3].

## How sources are classed

- **PRIMARY** - authored by the panel maker (E Ink Holdings / E Ink Corporation), the module maker,
  or the controller-IC vendor. Includes E Ink patents, which are E Ink-authored.
- **NEAR-PRIMARY** - vendor-authored but retrieved from a mirror, an archive snapshot, or a gated
  document. The text is the vendor's; the retrieval path is not the vendor's own site.
- **EXPERT-SECONDARY** - the author of a driver or a reverse-engineering effort. Knows the hardware,
  does not speak for the manufacturer.
- **WEAK** - blog, forum, community wiki. Nothing load-bearing rests on these.

## Verification status

- **QUOTED** - the agent that found it reported it as verbatim from the document.
- **UNVERIFIED-URL** - the document is gated, 404s at source, or was read via a mirror. The wording
  is reported verbatim but a second reader could not necessarily re-fetch it.
- **NEGATIVE** - a search that found nothing. Recorded because absence is evidence here.

---

# E Ink Corporation / E Ink Holdings

## [EI-P1] US7952557B2 - drive scheme table and dwell-time table

PRIMARY. https://patents.google.com/patent/US7952557B2/en - QUOTED

> "black to black - 0 V for 420 msec ... white to white - 0 V for 420 msec. This drive scheme is DC
> balanced, because any series of transitions that brings a pixel back to its initial optical state
> is DC balanced, that is, the net area under the voltage profile for the entire series of
> transitions is zero."

Also ships a dwell-time-indexed impulse table (0-0.3 s: -15 V for 280 ms; 3 s or greater: -15 V for
400 ms; total always 420 ms, trading drive time against trailing 0 V), and warns that dwell
compensation breaks DC balance:

> "no longer DC balanced" ... "Repeating this loop causes a build-up of DC imbalance."

**Read the scope carefully.** `TABLE 1` is introduced with "For example, one might begin with a
drive scheme for a **two optical state (black and white) display**". Three consequences:

1. It is an **illustrative example**, not the patent's invention, and it is deployed as a _foil_ -
   the patent immediately uses it to show that dwell-time compensation breaks DC balance.
2. It is a **two-state (1-bit)** scheme. The TRMNL X is a 16-grey-level panel.
3. In the patent's actual invention (a balanced pulse-pair scheme) a black-staying pixel is **not**
   held at 0 V: "the base waveform comprises, in succession, a first reset pulse sufficient to drive
   the pixel to or close to one of its extreme optical states, a second reset pulse sufficient to
   drive the pixel to or close to its other extreme optical state, and the at least one set pulse."

So this table does **not** establish "black to black is always 0 V" as a law of the technology. It
establishes that zero-drive same-state transitions are a normal, DC-balanced design in schemes that
do differential updates. See [README.md](README.md) P2 for how the argument is actually carried,
which is via optical rails and full-update compensation rather than via this table.

The same patent supplies the optical-rail passage that does the real work, and it is a direct answer
to the "pigment driven to the top gets overcharged" picture:

> "Almost all electro-optic medium have a built-in resetting (error limiting) mechanism, namely
> their extreme (typically black and white) optical states, which function as \"optical rails\".
> After a specific impulse has been applied to a pixel of an electro-optic display, that pixel
> cannot get any whiter (or blacker). For example, in an encapsulated electrophoretic display, after
> a specific impulse has been applied, all the electrophoretic particles are forced against one
> another or against the capsule wall, and cannot move further, thus producing a limiting optical
> state or optical rail."

E Ink confirms the physical picture - particles really are forced against the capsule wall - and in
the same sentence says they **cannot move further**. There is no "further" to drive them to.

Immediately after, the "soft rails" paragraph, which points the opposite way from "avoid black":

> "Because there is a distribution of electrophoretic particle sizes and charges in such a medium,
> some particles hit the rails before others, creating a \"soft rails\" phenomenon, whereby the
> impulse precision required is reduced when the final optical state of a transition approaches the
> extreme black and white states, whereas the optical precision required increases dramatically in
> transitions ending near the middle of the optical range of the pixel."

Driving to the extremes is the **forgiving** case. Mid-greys are the demanding one.

## [EI-P2] US7119772B2 / US7733311B2 - DC balance requirement, dwell-time dependence

PRIMARY. https://patents.google.com/patent/US7119772B2/en ,
https://patents.google.com/patent/US7733311B2/en - QUOTED

> "accurately DC-balanced waveforms (i.e., the integral of current against time for any particular
> pixel of the display should be held to zero over an extended period of operation of the display)"
> ... "to preserve image stability, maintain symmetrical switching characteristics, and provide the
> maximum useful working lifetime of the display"

> "It has been found that, at least in some cases, the impulse necessary for a given transition
> various [sic] with the residence time of a pixel in its optical state, this phenomenon, which does
> not appear to have previously been discussed in the literature, hereinafter being referred to as
> \"dwell time dependence\" or \"DTD\""

("various" is how the granted text reads; presumably "varies". Note also the hedge "at least in some
cases", which an earlier draft of this file dropped.)

Residence time is defined as "the period since the pixel last underwent a non-zero transition".

## [EI-P3] US11107425B2 - DC imbalance shortens lifetime; multi-year ghosting drift

PRIMARY. https://patents.google.com/patent/US11107425B2/en - QUOTED

> "DC-imbalanced drive schemes or waveforms can cause hardware degradations over time which shortens
> display devices' lifetime."

> "DC-balanced waveforms have been proven to improve long-term usage of EPDs by reducing severe
> hardware degradations"

> "display gray-tone ( FIG. 2A ) and ghosting shift ( FIG. 2B ) values can increase significantly in
> a two year period after tens of thousands update cycles."

## [EI-P4] US10520786B2 - the controlled DC-balance experiment

PRIMARY. https://patents.google.com/patent/US10520786B2/en - QUOTED

> "Both displays, when driven with a DC-balanced waveform, exhibited only small changes in the
> measured open-circuit voltage. The display of the invention exhibited less than half the
> open-circuit voltage build-up of the control display after prolonged driving with the
> DC-imbalanced waveform."

> "FIG. 5 shows the b* value of the white state of the displays driven as described above" ... "Both
> displays, when driven with a DC-balanced waveform, exhibited only small changes in the measured b*
> value of the white state" ... "The display of the invention exhibited about one fifth of the
> change in b* of the control display after prolonged driving with the DC-imbalanced waveform."

b* is the CIELAB blue-yellow axis, and the quantity measured genuinely is the white state's. Note
the comparison in the final sentence is _invention versus control_, not _b\* of the white state_ -
an earlier draft of this file misquoted it that way.

Now the irreversibility clause, **in full**, because the qualifiers change what it claims:

> "The degradation in display performance caused by development of remnant voltage is **generally
> reversible**, either by storing the display without further switching or by switching
> appropriately to rebalance the DC impulses. In cases where a **prior art** electrophoretic display
> is driven with **extreme degrees of DC-imbalance**, however, it is possible that the electrodes
> may be irreversibly degraded, presumably by electrochemical reactions that consume the electrode
> materials."

So: remnant-voltage degradation is _generally reversible_. Irreversible electrode damage is a worst
case for a **prior-art** display (one lacking this patent's redox chemistry) driven at **extreme**
imbalance. It is not a documented ordinary failure mode, and this file previously presented it as
one.

## [EI-P5] WO2005054933A2 - imbalance and remnant voltage

PRIMARY. https://patents.google.com/patent/WO2005054933A2/en - QUOTED

> "DC imbalances cause long-term lifetime degradation of electrophoretic displays." "remnant
> voltages can lead to so-called 'ghosting' phenomena"

## [EI-P6] US11568827B2 - definitions of ghosting and edge ghosting

PRIMARY. https://patents.google.com/patent/US11568827B2/en - QUOTED

> "'ghosting' refers to a situation in which, after the electro-optic display has been rewritten,
> traces of the previous image(s) are still visible." "'edge ghosting,' a type of ghosting in which
> an outline (edge) of a portion of a previous image remains visible."

## [EI-P7] US7528822B2 - mixed-temperature driving creates DC imbalance

PRIMARY. https://patents.google.com/patent/US7528822B2/en - QUOTED

> "consider a display that repeatedly transitions from white to black at 25 C and then from black to
> white at 0 C. The slower response at low temperature will typically dictate using a longer pulse
> length. As a result, the display will experience a net DC imbalance towards white."

Relevant to any panel that updates across a day/night temperature swing.

## [EI-P8] US7623113B2 - temperature scaling of update time

PRIMARY. https://patents.google.com/patent/US7623113B2/en - QUOTED

Roughly 5x longer update at 0 C than 25 C, and about 0.2x at 65 C, measured over 200+ random
transitions per point. Scaling is quadratic in temperature difference, not Arrhenius.

## [EI-P9] US8797259B2 - pigment adhesion to capsule walls

PRIMARY. https://patents.google.com/patent/US8797259B2/en - QUOTED, but ISOLATED

> "stuck to the wall membranes of the microcapsules"

This is the best available mechanism statement for long-dwell particle adhesion, and it is the
**only** one found. No independent corroboration in patents or peer-reviewed literature. Treat as a
single-source claim.

## [EI-W1] AF Waveform Mode Declaration - the ghosting rating table

PRIMARY (E Ink-authored), NEAR-PRIMARY retrieval (Waveshare mirror).
https://files.waveshare.com/upload/c/c4/E-paper-mode-declaration.pdf - QUOTED

Table 1, Ghosting column:

| Mode     | Ghosting     |
| -------- | ------------ |
| INIT     | N/A          |
| DU       | Low          |
| **GC16** | **Very Low** |
| GL16     | Medium       |
| GLR16    | Low          |
| GLD16    | Low          |
| A2       | Medium       |
| DU4      | Medium       |

GC16 is the full 16-level greyscale update, which drives pixels through black and white. E Ink rates
it the **lowest**-ghosting mode available.

Same document, on the remedy for accumulated ghosting:

> "The use of a white image in the transition from 4-bit to 1-bit images will reduce ghosting and
> improve image quality for A2 updates." "It is also recommended to use a white image after a
> sequence of A2 updates"

The prescribed remedy is a **white** frame - a fixed colour, not varied content.

## [EI-S*] E Ink Holdings panel specifications - NEGATIVE RESULT

PRIMARY. Retrieved: ES103TC1, ED060SC7, ED060SCE, ED060SCT, ED060KC1, ED013TC1, ED078KC2
(VB3300-GHC), ED097TC2, ED103TC2, ED133UT2, plus the 10.3" and 13.3" specs.

- ES103TC1: https://community.nxp.com/ - P-511-754-V1_ES103TC1.pdf
- ED078KC2: https://mm.digikey.com/ - VB3300-GHC_ED078KC2_V3.0_12-13-21.pdf
- 13.3": https://files.waveshare.com/upload/5/5d/13.3inch-e-paper-specification.pdf

**"ghosting" and "image sticking" appear zero times. There is no static-image time limit of any kind
in any E Ink Holdings panel specification.** Confirmed by three independent agent reads.

The 24-hour rule is module-maker text. **Do not attribute it to E Ink.**

What these specs do state:

> "Operating Temp. Range TOTR 0 to +50 C" / "Storage Temperature TSTG -25 to +70 C"

> "3 High Temperature Storage | T=+70C RH=40% for 120hrs (Test in white pattern)"

**Correction:** an earlier draft said "every reliability test row is qualified '(Test in white
pattern)'". That is false. In the 13.3" spec only 3 of 8 rows carry it (Low-Temperature Storage,
Temperature Cycle, Solar radiation), and its High-Temperature Storage row reads
`T = +70C, RH = 23%
for 240 hrs` with no qualifier. The quoted row above comes from a different spec
in the set. The correct claim is narrower: _some_ reliability rows specify a white test pattern, and
the park-on-white guidance lives in [PDI-1] and [GD-1] rather than here.

ES103TC1 §6.2, the nearest thing to a saturation limit anywhere, and it is a driver rail spec rather
than a statement about black content:

> "Asymmetry Source | VASM | VPOS+VNEG | -800 | 0 | 800 | mV"

ED133UT2 §7, the only power-down clause in the whole E Ink corpus read:

> "All of Vcom/VNEG/VPOS/VGN/VGL MUST turn off right after data transfer completes."

## [EI-X1] eink.com Segmented Quick Start Kits

PRIMARY. https://www.eink.com/product/detail/Segmented-Quick-Start-Kits - QUOTED

> "E Ink displays use occasional global updates to refresh the display. The software is designed to
> send a global update to the display at the beginning of each demo and after ten actions are
> executed. The frequency of global updates is subjective to the customer and application."

E Ink calls the global-update cadence "subjective". They publish no mandatory number.

---

# Module makers

## [PDI-1] Pervasive Displays 1P257-00 Rev.04, 2.66" E2266CS0C1/C2, §8 Precautions (16)

NEAR-PRIMARY (live site 404s; Internet Archive snapshot of a PDi-authored PDF). 2021-11-29.
https://web.archive.org/web/20220601000000id_/https://www.pervasivedisplays.com/wp-content/uploads/2021/12/1P257-00_04_E2266CS0C1-E2266CS0C2_20211129.pdf -
**QUOTED, RE-FETCHED** - independently re-retrieved from this exact archive URL by a second reader;
clause (16), the white-pattern note and the 5-year lifetime line all confirmed verbatim. The live
vendor site still 404s, but the archive URL is stable.

> "(16) If the EPD Panel / Module is not refreshed every 24 hours, a phenomena known as 'Ghosting'
> or 'Image Sticking' may occur. It is recommended that customer refreshed the ESL / EPD Tag every
> 24 hours in use case. It is recommended that customer ships or stores the ESL / EPD Tag with a
> completely white image to avoid this issue"

Note what this clause is about: **not refreshing**. It says nothing about what the image contains.
It does not support "black is worse".

Also §2.2 p.12: "Note (3): Stay white pattern for storage and non-operation test." Also §2.3: "The
EPD Module is designed for a 5-year life-time with 25 C/50%RH operation assumption."

## [PDI-2] Pervasive Displays 1P278-00 Rev.02, 7.4" E2741CS0B2 - the mono instance

NEAR-PRIMARY. QUOTED (mirror listed below re-fetched and confirmed by a second reader).

The identical clause, in a datasheet whose "Display Colors" field reads **Black/White**. This
matters: an earlier reading suggested the 24-hour rule was colour-panel-only. It is not. The same
wording appears in Waveshare's 7.5" V2 mono spec §9(5), Good Display GDEY075Z08 §15(5), and PDi's
1.54" B/W ESL spec.

Same clause also in [PDI] 1P377-00 Rev.01 (wide-temp E2266KS0C*, 2024-03-20) and 1P255-00 Rev.02
(E2154CS0C1, mirrored at
https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/7559/1P2550002E2154CS0C120201221.pdf).

## [PDI-3] Pervasive Displays "Fast update Application Guide", Doc. PDW001 Rev. 02, Nov 2025

NEAR-PRIMARY (download-gated, no stable public URL).
https://www.pervasivedisplays.com/download/5978/ - **QUOTED, RE-FETCHED**. An earlier draft called
this "download-gated, no stable public URL". Wrong: the URL served the PDF to an unauthenticated
request on the first try, and the cover confirms "Doc. No. PDW001 Rev. 02 (Nov 2025)". All quotes
below re-verified verbatim.

Table 4 p.8, on normal update:

> "Each pixel needs to be compensated (inversed from original image and inversed from new image) and
> reset (full white screen) to keep almost the same moving distance for every particle in the
> capsule of FPL. It helps for improving ghosting effect and extend the lifetime of FPL."

Table 4 p.8, on fast update, which omits those stages:

> "However, there is neither compensation nor reset stages in between. Such operations will cause
> the particles in FPL to be overdriven in an unbalanced state. Over a long period of time, ghosting
> image may appear, and at worst, the EPD module will have a short lifetime or even cause damage
> that cannot be recovered to original optical performance."

§1.10.3 p.18:

> "The charged particles in the ink material are in unbalanced state while fast refreshing
> continuously. They need either compensation or inversed image to clean the ghosting effect,
> maintain the optical performance and extend the lifetime of EPD module."

> "Based on our experiments, we highly recommend running a normal update or power off the CoG to
> wait until next cycle is coming: 1. After 50 to 100 fast updates 2. 30 seconds without any screen
> changes (e.g. idle state) 3. Ghosting effect starts to appear on screen 4. Totally different
> template or scene"

§1.5 p.9: "Hard to clear the ghosting images permanently"

**A full redraw is the thing that extends panel life.** The hazard is the mode that skips
compensation. That is a mode question, not a content question.

## [PDI-4] Pervasive Displays Knowledge Base - "Updating the Display" warning box

PRIMARY. https://docs.pervasivedisplays.com/knowledge/Technology/updating-the-display.html - QUOTED

> "Partial Update support has been suspended indefinitely." "Pixels outside the Partial Update
> window (i.e. the unchanged pixels) degrade faster over time with continued use of this
> functionality. These unchanged pixels are in an unbalanced/unstable state, which impacts the
> lifespan of the display."

**This is the direct inverse of the "redrawing damages" hypothesis.** The pixels that degrade are
the ones left alone.

## [PDI-5] Pervasive Displays Knowledge Base - Ghosting

PRIMARY. https://docs.pervasivedisplays.com/knowledge/Technology/ghosting.html - QUOTED

> "Ghosting is the effect of seeing artifacts of a previous image on the display. EPDs are by nature
> prone to ghosting effects if the driving waveform was not well behaved implemented. The ghosting
> image looks like a grey shade of the previous object is embedded in the new object."

## [PDI-6] Pervasive Displays Knowledge Base - Fast Update Data Comparison

PRIMARY.
https://docs.pervasivedisplays.com/knowledge/Hardware/troubleshooting/ghosting/fast-update-data-comparison.html -
QUOTED

> "Per our experiments, we highly recommend that" ... "after 20 Fast Updates of iTC" / "30 seconds
> without any screen changes (e.g. idle state)" / "ghosting effect starts to appear on screen" ...
> "you are better to run a standard Global Update or power off the CoG"

**Conflicts with [PDI-3]**: 20 here, 50-100 in the Nov 2025 application guide. Unresolved.

## [PDI-7] Pervasive Displays library - the Regenerate function

PRIMARY (vendor-published source). QUOTED

```cpp
/// @brief Regenerate the panel
/// @details White-to-black-to-white cycle to reduce ghosting
```

The vendor's own de-ghost routine drives every pixel to full black. Driving to black is the cure,
not the harm.

## [GD-1] Good Display, "ePaper Display Usage Guidelines"

PRIMARY. PDF:
https://v4.cecdn.yun300.cn/100001_1909185148/ePaper%20Display%20Usage%20Guidelines.pdf - QUOTED.
**Cite the PDF, not the HTML page** - https://www.good-display.com/news/80.html is a condensed
rewrite with different wording and does not support these quotes as written.

> "Partial Update: After every 5 partial updates, perform a full update on the ePaper display to
> prevent ghosting on the screen."

> "Store the ePaper display with the front facing up and flat, displaying a white pattern. This
> orientation helps prevent inerasable ghosting from occurring."

> "Displaying a white pattern during storage prevents inerasable ghosting"

> "Maintain a controlled environment with a temperature range of 23+/-3C and a humidity range of
> 55+/-10%RH"

Note the CDN 403s without a Referer header.

## [GD-2] Good Display, "New Here? Start Here!" (2025)

PRIMARY. https://www.good-display.com/news/236.html - QUOTED

> "Regular use: It is recommended to perform a full-screen refresh every 24 hours for multi-color
> and color displays, and once per week for black-and-white displays."

> "Never leave static images displayed: When showing unchanged content, set the display to sleep
> mode or completely power off. Extended high voltage can cause irreversible film damage."

**Read the second quote in full.** The headline says "static images"; the body is a **power-state**
rule about high voltage on the film. This is the most commonly conflated sentence in the whole
subject area.

## [GD-3] Good Display, "E-paper display's different update mode"

PRIMARY. https://www.good-display.com/news/134.html - QUOTED

> "our recommendation is to do one full update after five or six partial or fast updates"

## [GD-4] Good Display GDEP100E01 (10.2") specification §13 (5)

PRIMARY. https://v4.cecdn.yun300.cn/100001_1909185148/GDEP100E01.pdf - QUOTED

The 24-hour clause, near-identical to [PDI-1] but **not word-for-word**: Good Display reads "It is
recommended _to refreshed_", Pervasive Displays reads "It is recommended _that customer refreshed_".
Also present in GDEM075F53, GDEY097F91, GDEW0215T12, GDEY0426T82, GDEY075Z08.

## [GD-5] Good Display / e-paper-display.com, "Precautions for E-paper Display" §1.2

PRIMARY. https://www.e-paper-display.com/news_detail/newsId=53.html - QUOTED

> "Maximum storage time: If stocking in bulk, the storage time should not exceed 6 months. If it is
> more than 6 months, please update the screen at least every 6 months to keep the microcapsule
> active. Please note that there must be no contents displayed on the screen when stored."

## [GD-6] Good Display FAQ

PRIMARY. https://www.good-display.com/faq/1.html - QUOTED

> "Usually there should'nt be any delay between initializatio and refresh because that will let the
> E-paper film stay on high-voltage."

(Vendor's own typos preserved.)

## [WS-1] Waveshare, Template:E-paper-precautions mono

PRIMARY for Waveshare's own modules; SECONDARY as a claim about the E Ink panel inside.
https://www.waveshare.com/wiki/7.5inch_e-Paper_HAT_Manual - QUOTED

> "When using the e-Paper display, it is recommended that the refresh interval is at least 180s, and
> refresh at least once every 24 hours."

> "For e-Paper displays that support partial refresh, please note that you cannot refresh them with
> the partial refresh mode all the time. After refreshing partially several times, you need to fully
> refresh EPD once. Otherwise, the display effect will be abnormal, which cannot be repaired!"

> "Note that the screen cannot be powered on for a long time. When the screen is not refreshed,
> please set the screen to sleep mode or power off it. Otherwise, the screen will remain in a high
> voltage state for a long time, which will damage the e-Paper and cannot be repaired!"

> "Refresh in a low temperature environment may appear color cast, it need to be static in the
> environment of 25C for 6 hours before refresh."

The power-state rule and the image-duration rule sit in the same bullet list here. They are
different mechanisms.

## [WS-2] Waveshare, Template:IT8951 Epaper FAQ

PRIMARY for Waveshare. https://www.waveshare.com/wiki/10.3inch_e-Paper_HAT - QUOTED

> "During the use of the e-paper screen, it is recommended that customers update the display screen
> at least every 24 hours. (If the screen keeps the same picture for a long time, there will be a
> burn-in situation that is difficult to repair)."

## [WS-3] Waveshare, Template:E-paper FAQ mono

PRIMARY for Waveshare. https://www.waveshare.com/wiki/13.3inch_e-Paper_HAT_(K)_Manual - QUOTED

> "Ideally, with normal use, it can be refreshed 1,000,000 times (1 million times)."

> "During the use of the multi-color e-paper screen, it is recommended that customers update the
> display screen at least once every 24 hours. (If the screen keeps the same picture for a long
> time, the screen will burn and it is difficult to repair.)"

## [WS-4] Waveshare, Template:6inch HD e-Paper user manual (IT8951)

PRIMARY for Waveshare. https://www.waveshare.com/wiki/6inch_HD_e-Paper_HAT - QUOTED

> "It is recommended to use INIT mode to clear the screen after several A2 mode refreshes"

## [SC-1] Sinocrystal SCP075001-V01 Ver A0, 2021-10-22, §10 (17)

PRIMARY. https://www.displaysino.com/upload/portal/20230814/535b7278c9cdbcc06e65a2a072dbfeb1.pdf -
QUOTED

The 24-hour clause verbatim, ending "...every 24 hours in use case with white image."

## [DKE-1] DKE CO.,LTD, EPD Module User Manual DEPG0290BNS75AF0 V2.6, §8

PRIMARY (Heltec mirror).
https://resource.heltec.cn/download/e-ink/290/2.90b&w/DEPG0290BxS75AFxX_BW/DEPG0290BNS75AF0%20V2.6_FINAL.pdf -
QUOTED

> "Life | Topr | 1000000times or 5years"

Appearance inspection table, cosmetic acceptance criteria:

> "4 | Ghost image | Allowed in switching process | MI | Visual inspection"

The panel's budget is expressed in **update count**, independent of what colour is drawn. 1,000,000
updates at one refresh per 15 minutes is roughly 28 years.

---

# Controller ICs

## [SSD-1] Solomon Systech SSD1680 Rev 0.14 p.17 (identical in SSD1675B / SSD1677 / SSD1681)

PRIMARY (distributor mirror).
https://cdn-learn.adafruit.com/assets/assets/000/097/631/original/SSD1680_Datasheet.pdf - QUOTED

> "Precaution: Please ensure the temperature range covers whole range of application temperatures,
> display will not be updated if no suitable temperature range matches the sensed temperature."

The documented consequence of a temperature/LUT mismatch is that **the refresh does not happen**,
not that the panel degrades.

Command 3F "End Option" p.30 offers, with no warning attached:

> "07h Source output level keep previous output before power off"

## [UC-1] UltraChip UC8179c Rev 0.6 p.52 (identical in UC8276c, UC8253c)

PRIMARY (distributor mirror). https://cursedhardware.github.io/epd-driver-ic/UC8179c.pdf - QUOTED

> "In 'Deep Sleep Mode', the control signals are recommended tied to 0v to avoid IO leakage current.
> And the die must be keep away from light which causes photoelectric effect to make internal nodes
> unstable."

Framed as power saving and leakage stability, not panel protection.

## [IC-NEG] Controller datasheets - NEGATIVE RESULT

PRIMARY. SSD1675B, SSD1677, SSD1680, SSD1681, UC8151c, UC8179c, UC8253c, UC8276c, IT8951.

- **No partial-refresh count limit in any IC datasheet.** They document PTIN/PTOUT and "Support
  display partial update" with no ceiling attached.
- **The string "balanc" does not appear in any of the nine documents.** DC balance is documented
  only by E Ink, and only in patents.
- No "wrong LUT damages the panel" warning anywhere.
- ITE IT8951 docs are NDA-gated; copies read were reseller mirrors stamped CONFIDENTIAL.

---

# Driver implementations and reverse engineering

## [IMP-1] Larry Bank, bb_epaper wiki - author of FastEPD and the TRMNL X display code

EXPERT-SECONDARY (but note: this is the author of the code running on the device).
https://github.com/bitbank2/bb_epaper/wiki/How-e%E2%80%90Paper-works-and-how-to-work-with-it -
QUOTED

> "For differential updates, the BB and WW sections of the LUT will contain push instructions of 00
> (do nothing) since the color of those pixels is already set to the desired state."

> "a charge imbalance is usually not a fatal situation for the display."

Same-state pixels get **do nothing**. Independent confirmation of [EI-P1] at the driver level.

## [IMP-2] schuhumi, epdiy issue #226 - hand-building a DC-balanced waveform

EXPERT-SECONDARY. https://github.com/vroland/epdiy/issues/226#issuecomment-1895893829 - QUOTED

Black-to-black is `[0,0,0,0]`, and "dc balance stays the same".

## [IMP-3] Jan Sebastian Goette, gdepaper DRM driver

EXPERT-SECONDARY. https://lore.kernel.org/all/95b64347-fbc8-ba3d-79da-9de2557ff95e@jaseg.net/ -
QUOTED, **NOT ARCHIVED**. The host is behind an anti-bot challenge that blocks plain clients and its
`/raw` endpoint, and the Wayback Machine has no snapshot. Verified live during research but not
re-checkable from this repo. Corroborating only - [GD-2] and [WS-1] carry the same point and are
archived.

```c
/* Power off the boost regulators. This must be done as soon as the display is
 * updated to avoid burn-in damage if powered on over a long time. */
```

Burn-in damage is attributed to the **boost regulators staying on**, not to what is displayed. Keeps
the two hazards apart where the vendor bullet lists run them together.

## [IMP-4] Inkplate issue tracker, PR #34 - the one documented real burn-in case

WEAK (community report), but recorded because it is the only concrete instance found.

The burn-in came from a **Game of Life animation** - content that never repeated. That is the "vary
your content" prescription producing the outcome it promises to avoid.

## [IMP-NEG] Implementation trees - NEGATIVE RESULTS

- The word **"overcharge" appears in none** of: E Ink specs, PDi docs, Good Display, Waveshare,
  bb_epaper, FastEPD, epdiy, Inkplate, fread-ink, `mxc_epdc_fb.c`, `repaper.c`, or any
  lore.kernel.org thread.
- `mxc_epdc_fb.c` / `mxc_epdc_v2_fb.c` (about 12,600 lines) have zero matches for
  `ghost|retention|burn|damage|dc balance`, and never force a periodic GC16.
- epdiy and Inkplate trees contain no warning about static images at all.

---

# Academic literature

## [ACAD-1] Zhou, Johnson, Henzen, van de Kamer (Philips), IMID '05 Digest 11.4

Peer-reviewed. QUOTED

> "The achieved white state has a lower than desired reflectivity and is also different on t_wait.
> When a series of short voltage pulses alternating between positive and negative prior to the drive
> pulse is used, the white state error is significantly reduced... 6 up and down pulses with a time
> period of 20ms are applied prior to the drive pulse. The desired reflectivity is achieved,
> independent of t_wait."

Same drive pulse, different rest time in black, different white result. Six 20 ms shaking pulses
erase the dwell dependence entirely, **within the same refresh**. This is what the "particle
activation" phase in modern waveforms is for, and it is why dwell-time effects are recoverable
rather than cumulative.

## [ACAD-2] Micromachines 2018, 9, 143

Peer-reviewed. QUOTED

> "The initial idea for designing waveforms for a bistable property is simply applying zero voltage
> when pixels remain at the same state like the pixels in Area B of Figure 2 b and Figure 5 a. The
> waveform in Figure 2 b can remain the W-W state with 0 voltage. However, such a scheme will make
> the next step activation more difficult according to the inactivated particles. Therefore, the t_a
> phase is added to the waveform in Figure 5 a for W-W."

The archived copy also carries the paper's own result, which is the same shape as everything else
here - the cure is a better drive sequence, not different content:

> "By using this optimizing driving waveform, the image ghost contours can be completely erased
> without changing the EPD structure or materials for the same period of driving time."

A research group deliberately **added** drive to same-state transitions because leaving them idle
was the problem. The exact inverse of the hypothesis under test.

## [ACAD-3] JSID 2020 EPD lifetime study

Peer-reviewed. QUOTED

> "the Arrhenius accelerated lifetime model and the Peck accelerated lifetime model were not
> suitable for the lifetime prediction of EPD"

## [ACAD-4] OpenAlex search - NEGATIVE RESULT

Title and abstract search for `electrophoretic AND "image sticking"` returns **zero peer-reviewed
works**. The academic literature on permanent EPD image sticking is essentially empty.

Multiple Micromachines papers assert "EPDs would be damaged easily" by DC imbalance as background
convention, tracing back to E Ink's patents rather than to independent measurement. **No
quantitative threshold exists in any source**: no coulombs, no volt-seconds, no cycles-to-failure at
a stated imbalance.

---

# Sources deliberately not relied on

Consulted and found to be community-grade. **Nothing in [README.md](README.md) rests on any of
these**: GxEPD2 README (ZinggJM), Adafruit forums, Hacker News threads, Viwoods, Crystalfontz,
zbotic, esp32s.com, e-ink-reader.ru, Visionect blog and knowledge base.

One trap worth naming: `buydisplay.com` ER-EPD075 datasheets were Cloudflare-blocked, but search
snippets show their "Image Sticking" section is verbatim **LCD** boilerplate (liquid crystals,
polarizers, relaxed state). It would not have been usable EPD documentation.
