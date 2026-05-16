# 0003 — Render pipeline, Current Sample, and Current Image

**Status:** Accepted

## Context

The **Plugin** exposes `snapshot(t)` and `present(sample)`; the **Device** displays PNG bytes. The
**Server** owns the chain between them. It also needs a notion of "what the Device is currently
being shown" that's stable across the Plugin's `validity` window, so multiple polls in that window
don't trigger redundant work.

## Decision

### The Server holds a Current Sample and a Current Image

```ts
type CurrentSample = { state: unknown; validity: Temporal.Duration; t: Temporal.ZonedDateTime };
type CurrentImage = { png: Uint8Array; identity: string };
```

Two independent records. The Server replaces the Current Sample on every re-snapshot; it replaces
the Current Image only when a fresh render produces a different identity (see ADR-0004).

On a Device poll at `now`:

1. If `now < currentSample.t.add(currentSample.validity)` → return the Current Image (validity
   window in effect — no work).
2. Otherwise call `plugin.snapshot(now)` followed by `plugin.present(sample)` (always paired); the
   Server then runs the result through the render pipeline below.

Whether the Server ever holds _future_ Samples is a per-Plugin opt-in (deferred); the default is
"one Current Sample at a time."

If `snapshot(t)`, `present(sample)`, or invoking the view fails, the Server falls back to a
Server-supplied error view (a small "ErrorCard") with a short validity (~30s). If the error view
itself fails to rasterize, the error propagates and `/api/display` returns 500.

### The render pipeline

The Server owns everything from "we have a Sample + Presentation" through to "bytes the Device
fetches":

1. **Derive HTML.** Invoke the Plugin's view component with the Sample's state:
   `<presentation.view {...sample.state} />`. Run `renderToString` over the resulting JSX element,
   prefixed with `<!DOCTYPE html>`.
2. **Derive identity.** `sha256(html).hex.slice(0, 16)`.
3. **Identity comparison (short-circuit).** If the identity matches the Current Image's identity,
   keep the Current Image — steps 4–5 are skipped.
4. **Rasterize.** Hand the HTML to the **Renderer** (an abstract participant that internally fetches
   the HTML back from `/preview/:id`, screenshots at the active panel's geometry, and dithers to a
   4-bit grayscale PNG packed 2 px/byte, PNG color-type=0). The Renderer applies any rasterization
   hints from `presentation` it recognizes.
5. **Replace Current Image.** The new PNG plus its identity becomes the new Current Image, replacing
   the previous one.

The Image the Device fetches is always the Current Image's PNG; its `filename` is always
`image-${currentImage.identity}`. See ADR-0004 for the full caching framing and the role of
`validity`.

Panel-specific parameters (width, height, DPR, default bit depth, default dither mode) live in
`src/render/profiles.ts`. Adding a new panel model is a registry entry, not service code.

## Consequences

- The Plugin is unaware of the pipeline. It exposes `snapshot` + `present`; everything after is
  Server concern.
- The Device is unaware of the pipeline. It receives an Image and an identity.
- Per-Plugin error fallback is handled at this layer, so individual Plugins can stay unaware of HTTP
  semantics.
- Pre-rendering future Samples, if ever needed, slots in as an additional path that produces extra
  Images ahead of their validity window — no contract change required.
- Adding device models is cheap: a new registry entry, no service changes.
- The Server has a natural injection point (step 1's JSX construction) for future provider-wrapping
  or context injection without changing the Plugin contract.
- The Renderer is treated as a black box from the Server's perspective. Today it's CDP; tomorrow it
  could be anything that takes HTML and returns dithered PNG bytes.
