# 0003 — Render pipeline, Current Result, and Current Image

**Status:** Accepted

## Context

The **Plugin** exposes `run(ctx) → Result`; the **Device** displays PNG bytes. The **Server** owns
the chain between them. It also needs a notion of "what the Device is currently being shown" that's
stable across the Plugin's `validity` window, so multiple polls in that window don't trigger
redundant work. That ownership lives in the **Conductor**, the per-poll orchestrator inside the
Server.

## Decision

### The Conductor holds a Current Result and a Current Image

```ts
type CurrentResult = { ctx: RunContext; result: Result<unknown> };
type CurrentImage = { png: Uint8Array; identity: string };
```

Two independent records. The Conductor replaces the Current Result on every re-run; it replaces the
Current Image only when a fresh render produces a different identity (see ADR-0004).

On a Device poll at `now`:

1. If `now < currentResult.ctx.t.add(currentResult.result.validity)` → return the Current Image
   (validity window in effect — no work).
2. Otherwise call `plugin.run({ t: now, intent: "poll", device })` and run the resulting Result
   through the render pipeline below.

A prerender warm-up may replace the Current Result before the Device poll arrives (ADR-0007). The
poll-time path then takes the validity-in-effect branch.

If `plugin.run`, `renderer.deriveHtml`, or `renderer.rasterize` fails, the Conductor falls back to
a Server-supplied error view (a small "ErrorCard") with a short validity (~30s). If the error view
itself fails to rasterize, the error propagates and `/api/display` returns 500.

### The render pipeline

The Conductor owns everything from "we have a Result" through to "bytes the Device fetches":

1. **Derive HTML.** Call `renderer.deriveHtml(result)`. The Renderer invokes
   `result.view(result.state)` and runs `renderToString` over the resulting JSX element, prefixed
   with `<!DOCTYPE html>`. Returns an HTML string.
2. **Derive identity.** The Conductor computes `identity = identityFor(html)`. The exact hash
   function and length are encapsulated in `identityFor`; today: a truncated SHA-256 hex string.
   See ADR-0004.
3. **Identity comparison (short-circuit).** If the identity matches the Current Image's identity,
   keep the Current Image — steps 4–5 are skipped.
4. **Rasterize.** Call `renderer.rasterize(html, result.hints)`. The Renderer talks to a CDP
   sidecar to screenshot the HTML at the active panel's geometry, applies any `hints` it
   recognizes (dither, viewport, filters, …), and returns PNG bytes packed 2 px/byte, PNG
   color-type=0.
5. **Replace Current Image.** The new PNG plus its identity becomes the new Current Image,
   replacing the previous one.

The Image the Device fetches is always the Current Image's PNG; its `filename` is always
`image-${currentImage.identity}`. See ADR-0004 for the full caching framing and the role of
`validity`.

Panel-specific parameters (width, height, DPR, default bit depth, default dither mode) live in
`src/render/profiles.ts`. Adding a new panel model is a registry entry, not service code.

### Renderer is internal, stateless, and split

The Renderer is an internal Server module — not a separate process, not a user-facing surface. It
exposes two stateless functions:

- `deriveHtml(result) → string`
- `rasterize(html, hints) → Promise<Uint8Array>`

The split exists so the Conductor can insert the identity check between them: derive HTML cheaply,
hash it, and skip the expensive rasterize call when the identity matches. A CDP sidecar process
backs `rasterize`; the sidecar is `rasterize`'s implementation detail, not a participant in the
Plugin/Conductor/Renderer vocabulary.

## Consequences

- The Plugin is unaware of the pipeline. It exposes `run`; everything after is Conductor/Renderer
  concern.
- The Device is unaware of the pipeline. It receives an Image and an identity.
- Per-Plugin error fallback is handled at the Conductor layer, so individual Plugins can stay
  unaware of HTTP semantics.
- Prerender warm-ups (ADR-0007) slot in as a Conductor-triggered run of the same pipeline ahead of
  the Device's poll — no contract change required.
- Adding device models is cheap: a new registry entry, no service changes.
- The Renderer is treated as a black box from the Plugin's perspective. Today its `rasterize`
  talks to CDP/CloakBrowser; tomorrow it could be anything that takes HTML and returns dithered
  PNG bytes.
