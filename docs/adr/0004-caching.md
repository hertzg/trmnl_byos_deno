# 0004 — No server-side render cache; `validity` drives `refresh_rate` and the Device's filename cache

**Status:** Accepted

## Context

Two costs we could try to avoid:

1. **Server-side** — running CDP screenshot + dither takes meaningful CPU and burns the headless
   browser's working set. Doing it when the result would be byte-identical to what we already
   produced is, in principle, waste.
2. **Device-side** — every e-ink refresh draws meaningful battery and produces a brief, visible
   flicker as the panel cycles. The flicker is the load-bearing cost: it directly conflicts with the
   "inconspicuous decor" intent. Battery is the secondary cost. Repainting when the pixels are
   identical to what's already on screen is wasted energy and wasted attention.

An earlier iteration of this Server held a **Current Image** on the Conductor — one PNG keyed by its
HTML-hash identity, replaced only when a fresh render hashed differently. The Device's poll served
from that cache. It was a meaningful CPU win but had two downsides that compounded over time:

- Any pipeline glitch (transient upstream data fetch failure, race, etc.) could pin an error-view
  frame as the Current Image. The Device kept showing it until the Plugin's next non-erroring run
  produced different HTML — which, with deterministic plugins, could be a long time.
- Debug surfaces had to model "what the Device sees" separately from "what the Plugin would produce
  now" because they could legitimately differ. Useful but expensive in concept count.

## Decision

The Server holds no rendered-PNG cache. Every Device fetch re-renders.

### Single render path

`/preview/png` is the only thing that produces PNG bytes. The Device, the dashboard, and dev `curl`
all hit the same handler. It runs the Plugin (via CDP fetching `/preview`), screenshots, returns.
ADR-0003 has the request shape.

### `validity` still earns its keep — on the Device side

`Result.validity` plays two roles:

1. **Plugin → Conductor**: "my Result is good for this long." The Conductor surfaces it as
   `refresh_rate` on `/api/display`. The Device sleeps for that long before its next poll. A Plugin
   that's valid for an hour gets polled hourly; the Server isn't asked to render in the meantime.
2. **Plugin → Device**: indirectly. `refresh_rate` is the only handle the Server has on Device
   power; respecting `validity` is how a Plugin keeps a panel on a coin cell for months.

### Identity earns its keep — also on the Device side

The BYOS firmware deduplicates frames by `filename`. If the new poll's `filename` matches the
previous one's, the firmware skips the image download _and_ skips the e-ink refresh. That is the
load-bearing flicker-avoidance mechanism.

The Conductor computes `identity = identityFor(deriveHtml(result))` inside `/api/display` and
returns `filename = image-${identity}`. A Plugin whose HTML is stable across runs gets stable
filenames; the panel stays quiet.

### What we deliberately don't do

- **No server-side PNG cache.** The Conductor used to hold a Current Image keyed by identity; it no
  longer does. The win was modest (CDP screenshot at minute cadence is fine); the loss was
  occasional sticky error frames.
- **No LRU / history of past Images.** Same reasoning, stronger.
- **No prerender warm-up.** The previous design (ADR-0007, withdrawn) pre-rendered into the cache
  shortly before the Device's expected poll. Without a cache, there's nothing to warm; the render
  happens in the Device's request path. The Device's wake-up latency dominates the render cost
  anyway, so the loss is small.

### Why HTML (not state) is the identity input

Identity is still computed over the rendered HTML, not over `Result.state` directly. HTML captures
_both_ inputs to the Image — the state the Plugin produced _and_ the view it was rendered through.
State changes that don't affect rendering get free dedupe on the Device side; view-code changes
correctly invalidate without a version bump or restart dependency.

### View purity helps but isn't required

If `result.view` is pure on `result.state`, identical state → identical HTML → identical `filename`
→ Device skips the refresh. If the view reads `Date.now()` or closures, HTML differs on every run →
different `filename` → Device refreshes every poll. Output is still **correct**; flicker just stops
being suppressed.

`docs/plugin-authoring.md` documents view purity as best practice and walks through the
dashboard-visible traps when it's violated.

## Consequences

- **Conductor holds one mutable piece of state**: `latestDevice` (the last DeviceReport we parsed
  off `/api/display`). No `currentResult`, no `currentImage`, no validity-window logic, no
  identity-gated rasterize, no LRU.
- **CDP screenshot runs on every Device poll.** At minute-scale polling that's ~one render per
  minute per Plugin — fine for a single-Device deployment.
- **The Plugin runs twice per Device cycle** (once in `/api/display`, once in `/preview` via CDP). A
  misbehaving Plugin with side effects in `run` will see them duplicated; the contract treats `run`
  as a pure projection of context to Result anyway.
- **View code changes are caught immediately.** Edit `view`, save, next poll's `filename` changes,
  Device refreshes. Same property the old cache provided.
- **Tradeoff: external mutable assets are still not detected.** `<img src="https://cdn/x.jpg">`
  whose bytes change without the URL changing produces identical HTML → identical `filename` →
  Device skips a legitimately-changed render. Plugin authors who need this should inline mutable
  image bytes as data URIs so the change appears in the HTML.
- **No stuck-frame failure mode.** A transient `Plugin.run` failure renders the error view for one
  poll cycle (30s validity); the next poll re-runs from scratch.
