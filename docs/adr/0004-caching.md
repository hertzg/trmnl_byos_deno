# 0004 — Single-slot Image cache; `validity` drives `refresh_rate`, identity drives the Device's filename cache

**Status:** Accepted

## Context

Two costs we want to avoid:

1. **Server-side** — running CDP screenshot + dither takes meaningful CPU and burns the headless
   browser's working set. Doing it when the result would be byte-identical to what we already
   produced is waste.
2. **Device-side** — every e-ink refresh draws meaningful battery and produces a brief, visible
   flicker as the panel cycles. The flicker is the load-bearing cost: it directly conflicts with the
   "inconspicuous decor" intent. Repainting when the pixels are identical to what's already on
   screen is wasted energy and wasted attention.

A previous design (briefly held) tried to dodge both by keeping a **Current Image** keyed by HTML
hash on the Conductor; the Device's poll served from that cache. It had a sticky-error failure mode
(a transient `Plugin.run` failure could pin the error frame in the cache indefinitely) and required
modeling "what the Device sees" separately from "what the Plugin would produce now."

A subsequent design (also briefly held) went the other way and removed the server-side cache
entirely. That made the failure mode self-healing — every fetch was a fresh render — but cost two
Plugin runs per Device cycle and burned a CDP screenshot on every poll, even when the Bundle had not
changed.

Neither extreme was right. This ADR splits the difference: cache exactly one Image, keyed by the
Bundle's identity, with three tiers of laziness that compose into "do as little work as the Plugin's
`validity` allows."

## Decision

### Single-slot Image cache

The Slot holds at most one entry: `{ bundle, identity, image, cachedAt }`, where `image` is a
`Promise<Uint8Array>` started eagerly when the entry lands. The Slot has four operations:

- `put(entry)` — replace the current entry (the old one, if any, is GC'd; any pending rasterize on
  the old Bundle becomes orphaned).
- `display()` — return `{ identity, refreshIn }` if the entry is still valid, `null` otherwise.
- `image(id)` — return PNG bytes if `id` matches the entry's identity, `null` otherwise.
- `clear()` — invalidate. Next caller refills.

No LRU. No history. Exactly one Image at a time.

### Three tiers of laziness on `/api/display`

Conductor's orchestration loop uses the Slot to do as little work as the Bundle allows:

1. **Validity tier.** `slot.display()` returns metadata when the entry's `cachedAt + validity` is
   still in the future. No Plugin run, no Renderer call. Return cached identity.
2. **Identity tier.** Validity elapsed. Run Plugin → Bundle. Compute identity. If identity matches
   the previous Slot entry's identity, refresh the `cachedAt` only — no rasterize. (Reserved for
   when the rasterize cost is shown to matter; not yet implemented.)
3. **Render tier.** Identity differs (or Slot empty). Kick off `Renderer.rasterize(bundle)` (don't
   await), `slot.put({ bundle, identity, image })`, return new identity. The Device's subsequent
   `/image/<identity>.png` fetch awaits the eager rasterize.

The common case for an "inconspicuous decor" Plugin is Tier 1: the Device polls every minute, the
Plugin's validity is hours, the Slot answers without doing any work.

### Identity is `hash(html + assets)`

`Renderer.identity(bundle)` derives HTML and concatenates the asset bytes (in deterministic order),
hashes with SHA-256, truncates to 16 hex characters. The hash choice and the truncation length are
encapsulated inside Renderer — they can change without rippling through callers. (Device-side SPIFFS
cache handles ≥16 chars comfortably; the threshold was confirmed on PR #34.)

Identity is the basis of both:

- **Slot cache key.** The Slot stores one entry; its identity is the entry's identity. Tier-2
  comparison uses this.
- **Device filename cache.** Conductor returns `filename = image-<identity>` on `/api/display`. The
  BYOS firmware compares against the previous poll's filename; on match, the firmware skips both the
  image fetch and the e-ink refresh. That is the load-bearing flicker-avoidance mechanism.

### Why HTML + assets (not state)

The screenshot depends on the rendered HTML and the asset bytes the rendering pulls in. Hashing
state directly would miss view-code changes (different HTML for the same state) and asset edits
(same HTML, different bytes). Hashing HTML alone would miss asset edits that don't appear in the
HTML string (asset content that changes without a path change).

Hashing `html + assets` captures every input to the Image. The Plugin's state is upstream of HTML,
so state changes that don't affect rendering get free dedup; view-code changes correctly invalidate;
asset edits invalidate.

### View purity helps but isn't required

If `result.view` is pure on `result.state`, identical state → identical HTML → identical identity →
Slot hit, Device filename cache hit, no flicker. If the view reads `Date.now()` or closures, HTML
differs across runs → different identity every render → Slot misses every cycle and the Device
repaints every poll. Output is still **correct**; flicker just stops being suppressed.

`docs/plugin-authoring.md` documents view purity as best practice.

### `validity` plays two roles

1. **Plugin → Slot**: how long the current Bundle's Image is considered fresh. Slot answers
   `display()` non-null while validity hasn't elapsed.
2. **Plugin → Device** (via `refresh_rate`): the Conductor returns `ceil(remainingValidity)` so the
   Device sleeps until just after validity expires. A Plugin valid for an hour gets polled hourly.

### Eager rasterize

When `slot.put(entry)` lands, the entry's `image` promise has already been started by the caller
(Conductor). Subsequent `slot.image(id)` calls await the same promise. In the common Device flow
(poll → new identity → image fetch arrives ~milliseconds later), the screenshot is often already
done by the time the Device asks for it.

The single waste case is: the Slot expires, Conductor refreshes (eager rasterize), and then no one
ever fetches `/image/<that-id>.png` because the Device's filename cache happened to match the new
identity from a different path. In our flow this can't happen — new identity always triggers a fetch
— but if it did, the orphaned rasterize would just complete unused and the PNG would be GC'd with
the next `put()`.

### Dashboard's clear button

`POST /dashboard/clear` calls `slot.clear()`. Next `/api/display` (from the Device or from the
Dashboard's page reload) finds the Slot empty and refills. No separate "force refresh" code path —
invalidation + normal refill is the only mechanism.

### Error fallback uses the same Slot

A throw inside Conductor's orchestration loop (Plugin failure, view-time JSX error, etc.) causes
Conductor to build an error Bundle (server-supplied error-view + `errorValidity ~30s`) and re-enter
the same loop. The error Bundle gets its own identity, its own Slot entry, its own image promise.
The Device sees the error view for ~30s, then polls again. If the Plugin has recovered, the next
loop produces a real Bundle and the Slot rolls.

No stuck-frame failure mode: validity (30s for errors, the Plugin's own `validity` for real Results)
always bounds how long the Slot holds a given entry.

## Consequences

- **The Conductor's render-touching state collapses to one structure**: the Slot's single entry.
  Plus `latestDevice` for the DeviceReport. No `currentResult`, no `currentImage`, no
  validity-window logic outside Slot.
- **Common-case Device polls do zero render work.** Tier 1 fires whenever
  `validity > poll
  interval`, which is the design target for "inconspicuous decor."
- **CDP rasterize happens at most once per identity change**, not once per poll.
- **The Plugin runs at most once per Device cycle** (was twice). On Tier 1 hits, it doesn't run at
  all.
- **Mid-cycle Slot expiry is self-healing.** If a request lands precisely as validity rolls over,
  the loop refills and serves the fresh Image; the old PNG is GC'd.
- **External mutable assets are still not detected.** `<img src="https://cdn/x.jpg" />` whose bytes
  change without the URL changing produces identical HTML → identical assets (the URL is not an
  asset under our model) → identical identity → Device skips a legitimately-changed render. Plugin
  authors who need this should inline mutable image bytes as data URIs so the change appears in the
  HTML.
- **No stuck-frame failure mode.** A transient `Plugin.run` failure shows the error view for ~30s;
  the next poll re-runs from scratch.
- **No LRU, no history, no separate "what the Device sees" model.** The Slot's current entry is what
  the Device sees. Dashboard reads `slot.display()` for "current identity" and embeds
  `/image/<identity>.png` — same data path as the Device.
