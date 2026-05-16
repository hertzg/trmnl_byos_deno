# 0004 — Avoiding redundant work: validity, identity, and the Current Image

**Status:** Accepted

## Context

Two costs we want to avoid:

1. **Server-side** — running the Renderer (CDP screenshot + dither) takes meaningful CPU and burns
   the headless browser's working set. Doing it when the result would be byte-identical to what the
   Server is already holding is pure waste.
2. **Device-side** — every e-ink refresh draws meaningful battery and produces a brief, visible
   flicker as the panel cycles. The flicker is the load-bearing cost: it directly conflicts with the
   "inconspicuous decor" intent. Battery is the secondary cost. Repainting when the pixels are
   identical to what's already on screen is wasted energy and wasted attention.

The **Server** holds exactly one **Current Sample** and one **Current Image** (ADR-0003). There is
no LRU of past Images. So "caching" here is not a lookup over history — it's a single decision at
re-snapshot time: _do we replace the Current Image, or keep it?_

## Decision

Two independent mechanisms, both consistent with "Server holds one Current Sample + one Current
Image":

### `validity` governs when to do anything at all

`Sample.validity` plays three roles, all the same idea ("this is fresh for this duration"):

1. **Plugin → Server**: "my state is good for this long; don't re-snapshot before that."
2. **Server self-management**: "don't call `snapshot` again until `t.add(validity)`."
3. **Server → Device**: `refresh_rate = validity`. "Come back to poll after this duration."

While the Current Sample is still inside its validity window, every Device poll is answered with the
existing Current Image. No `snapshot`, no `present`, no rasterization — pure read.

### Identity comparison governs whether to re-rasterize

When `validity` has expired, the Server re-snapshots. `snapshot` and `present` are always called as
a pair (see ADR-0002 — `present` is cheap, so there's no incentive to skip it):

1. Call `plugin.snapshot(now)` → new Sample. Replace the Current Sample.
2. Call `plugin.present(sample)` → Presentation.
3. Invoke `<presentation.view {...sample.state} />`; run `renderToString` → HTML.
4. `identity = sha256(html).hex.slice(0, 16)`.
5. **Compare to the Current Image's identity:**
   - **Match** → keep the Current Image (its PNG bytes are still correct). Skip rasterization.
   - **Mismatch** → send HTML to the Renderer → screenshot → dither → new PNG. Replace the Current
     Image with `{ png, identity }`. The previous Image is discarded.

The Device-side filename is always `image-${currentImage.identity}`. When the Server keeps the
Current Image, the filename is unchanged; the Device's SPIFFS comparison matches `szPrevFile` and it
skips both the download and the e-ink refresh.

### Why HTML (not state) is the identity input

Identity is computed over the rendered HTML, not over `Sample.state` directly. HTML captures
**both** inputs to the Image — the state the Plugin produced _and_ the view (in the Presentation) it
was rendered through. State changes that don't affect the rendered output get free skips; view-code
changes (edit the component, save) correctly invalidate without any version bump or restart
dependency.

### View purity helps but isn't required

If `presentation.view` is pure on `sample.state`, identical state → identical HTML → identity match
→ Current Image kept → no Renderer call, no Device repaint. If the view reads `Date.now()` or
closures, HTML differs on every snapshot → identity mismatch → Renderer runs and the Device repaints
every time. The output is still **correct**; both savings just stop firing.

`docs/plugin-authoring.md` documents view purity as best practice and walks through the
dashboard-visible traps when it's violated.

## What we deliberately don't do

- **No LRU / history of past Images.** A Plugin that oscillates between two HTML outputs
  re-rasterizes on every transition, even if it produced one of them before. The Device-side
  filename cache still benefits on the second visit (the Device's RTC-persisted filename outlives
  the Server's memory of "what we held last"). Not worth the complexity for one Device polling every
  ~60s.
- **No state-hash skip-point.** `snapshot` and `present` are always paired; we don't try to
  short-circuit between them based on state equality. `present` is cheap and a state-hash skip would
  save only the cheap step. The save on the expensive rasterization comes from the HTML-hash check,
  which is correct under view-code changes too.

## Consequences

- **Server state is two records.** `CurrentSample = { state, t, validity }` and
  `CurrentImage = { png, identity }`. No cache eviction, no LRU bookkeeping.
- **The Renderer runs only when the new HTML actually differs from what the Server holds.** A Plugin
  whose snapshot+present produces the same HTML across many calls costs zero Renderer invocations
  across that stretch — the Server keeps the Current Image, the Device sees the same filename and
  skips.
- **`validity` is the universal "fresh-for" duration.** One Plugin-supplied value governs
  re-snapshot timing, Server idle behavior, and Device sleep — all telling the same story.
- **View code changes are caught immediately.** Edit `view`, save. Next snapshot produces different
  HTML → identity mismatch → fresh Renderer call → new Image → new filename → Device updates. No
  server-restart dependency for correctness.
- **`renderToString` runs on every re-snapshot.** Required to compute the identity. Tree walk on a
  JSX element; microseconds in practice.
- **Tradeoff: external mutable assets are not detected.** `<img src="https://cdn/x.jpg">` whose
  bytes change without the URL changing produces identical HTML → identical identity → Device skips
  a legitimately-changed render. Plugin authors who need this should inline mutable image bytes as
  data-URIs so the change appears in the HTML.
