# 0004 — Avoiding redundant work: validity, identity, and the Current Image

**Status:** Accepted

## Context

Two costs we want to avoid:

1. **Server-side** — running `Renderer.rasterize` (CDP screenshot + dither) takes meaningful CPU
   and burns the headless browser's working set. Doing it when the result would be byte-identical
   to what the Conductor is already holding is pure waste.
2. **Device-side** — every e-ink refresh draws meaningful battery and produces a brief, visible
   flicker as the panel cycles. The flicker is the load-bearing cost: it directly conflicts with
   the "inconspicuous decor" intent. Battery is the secondary cost. Repainting when the pixels are
   identical to what's already on screen is wasted energy and wasted attention.

The **Conductor** holds exactly one **Current Result** and one **Current Image** (ADR-0003). There
is no LRU of past Images. So "caching" here is not a lookup over history — it's a single decision
at re-run time: _do we replace the Current Image, or keep it?_

## Decision

Two independent mechanisms, both consistent with "Conductor holds one Current Result + one Current
Image":

### `validity` governs when to do anything at all

`Result.validity` plays three roles, all the same idea ("this is fresh for this duration"):

1. **Plugin → Conductor**: "my Result is good for this long; don't re-run before that."
2. **Conductor self-management**: "don't call `run` again until `ctx.t.add(validity)` — except for
   a scheduled prerender warm-up shortly before then (ADR-0007)."
3. **Conductor → Device**: `refresh_rate = validity`. "Come back to poll after this duration."

While the Current Result is still inside its validity window, every Device poll is answered with
the existing Current Image. No `run`, no `deriveHtml`, no `rasterize` — pure read.

### Identity comparison governs whether to re-rasterize

When `validity` has expired (or a prerender warm-up fires), the Conductor re-runs the pipeline:

1. Call `plugin.run(ctx)` → new Result. Replace the Current Result.
2. Call `renderer.deriveHtml(result)` → HTML string. (The Renderer invokes
   `result.view(result.state)` and runs `renderToString` internally; see ADR-0003.)
3. `identity = identityFor(html)`. The `identityFor` function encapsulates the hash choice and
   truncation length so they can change without rippling through the rest of the system; today it
   is a short SHA-256 hex prefix.
4. **Compare to the Current Image's identity:**
   - **Match** → keep the Current Image (its PNG bytes are still correct). Skip `rasterize`.
   - **Mismatch** → call `renderer.rasterize(html, result.hints)` → new PNG. Replace the Current
     Image with `{ png, identity }`. The previous Image is discarded.

The Device-side filename is always `image-${currentImage.identity}`. When the Conductor keeps the
Current Image, the filename is unchanged; the Device's SPIFFS comparison matches `szPrevFile` and
it skips both the download and the e-ink refresh.

### Why HTML (not state) is the identity input

Identity is computed over the rendered HTML, not over `Result.state` directly. HTML captures
**both** inputs to the Image — the state the Plugin produced *and* the view (in the Result) it was
rendered through. State changes that don't affect the rendered output get free skips; view-code
changes (edit the component, save) correctly invalidate without any version bump or restart
dependency.

### View purity helps but isn't required

If `result.view` is pure on `result.state`, identical state → identical HTML → identity match →
Current Image kept → no `rasterize` call, no Device repaint. If the view reads `Date.now()` or
closures, HTML differs on every run → identity mismatch → `rasterize` runs and the Device
repaints every time. The output is still **correct**; both savings just stop firing.

`docs/plugin-authoring.md` documents view purity as best practice and walks through the
dashboard-visible traps when it's violated.

## What we deliberately don't do

- **No LRU / history of past Images.** A Plugin that oscillates between two HTML outputs
  re-rasterizes on every transition, even if it produced one of them before. The Device-side
  filename cache still benefits on the second visit (the Device's RTC-persisted filename outlives
  the Conductor's memory of "what we held last"). Not worth the complexity for one Device polling
  every ~60s.
- **No state-hash skip-point.** `run` is one call; the only skip-point in the pipeline is after
  `deriveHtml`. A state-hash skip would save only the cheap `run` plus `deriveHtml`; the win on
  the expensive `rasterize` comes from the HTML-hash check, which is correct under view-code
  changes too.

## Consequences

- **Conductor state is two records.** `CurrentResult = { ctx, result }` and
  `CurrentImage = { png, identity }`. No cache eviction, no LRU bookkeeping.
- **`rasterize` runs only when the new HTML actually differs from what the Conductor holds.** A
  Plugin whose `run` produces the same HTML across many calls costs zero `rasterize` invocations
  across that stretch — the Conductor keeps the Current Image, the Device sees the same filename
  and skips.
- **`validity` is the universal "fresh-for" duration.** One Plugin-supplied value governs re-run
  timing, Conductor idle behavior, and Device sleep — all telling the same story. Prerender
  warm-ups (ADR-0007) shift *when* the re-run happens within the validity window without changing
  the budget.
- **View code changes are caught immediately.** Edit `view`, save. Next run produces different
  HTML → identity mismatch → fresh `rasterize` → new Image → new filename → Device updates. No
  server-restart dependency for correctness.
- **`renderToString` runs on every re-run.** Required to compute the identity. Tree walk on a JSX
  element; microseconds in practice.
- **Tradeoff: external mutable assets are not detected.** `<img src="https://cdn/x.jpg">` whose
  bytes change without the URL changing produces identical HTML → identical identity → Device
  skips a legitimately-changed render. Plugin authors who need this should inline mutable image
  bytes as data URIs so the change appears in the HTML.
