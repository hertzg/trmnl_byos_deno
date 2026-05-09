# 0005 — Drop /image.png query overrides, preview route, and kind distinction

**Status:** Accepted — 2026-05-09 **Related:** ADR-0001, ADR-0002, ADR-0003

## Context

`src/main.ts` currently carries three pieces of inherited weight that no longer fit the architecture
established by ADRs 0001–0003:

1. **Query-string render overrides on `/image.png`** —
   `?width=…&height=…&dpr=…&bitDepth=…&dither=…`. They were added when the render parameters were a
   service concern; with ADR-0002, stage-2 params are service-internal and stage-1 dims come from
   the template (or from the device profile registry). These knobs are now in the wrong place.

2. **`/` preview route.** It runs the template and returns HTML to the browser. With ADR-0003, the
   template no longer returns HTML directly — it returns tokens that point to PNG bytes. There's no
   "HTML to preview" in the user contract anymore.

3. **`DisplayKind = "preview" | "device"`** flag passed into the template's `run()`. Templates
   branch on it for cosmetic differences (e.g., showing a "(preview)" string when `kind=preview`).
   With ADR-0003 there's no preview entry point and no need for the distinction.

These three are coupled in the current code (e.g., the example template reads `kind` to compose
props the parser would otherwise inject) and should move together.

## Decision

Remove all three from iteration 1:

- Delete `intParam`, `floatParam`, `parseQueryOverrides`, `VALID_BIT_DEPTHS`, `VALID_DITHER_MODES`
  from `src/main.ts`. Drop the `callerOverrides` parameter from `runTemplate`. Drop
  `RenderOverrides` unless reused by `services.renderJsx`'s opts type.
- Delete the `/` route. Visiting the service in a browser will return 404 on `/`; the way to preview
  a template's output is to hit `/image.png`.
- Delete `DisplayKind` and the `kind` field on `RunContext`.

Future preview-style functionality, if needed, will be reintroduced as a deliberate, scoped feature
— not by inheriting today's preview path.

## Consequences

- The user template no longer needs to handle a `kind` flag. The example template loses its
  "(preview)"-mode branch.
- Anyone bookmarking `http://service/` to look at the screen has to switch to `/image.png`. README
  needs an update; that's a minor cost.
- The `/_render/:token` seam stays internally (it's how `services.renderJsx` hands HTML to CDP for
  rasterization), but it stops being adjacent to a user-facing preview endpoint and becomes an
  implementation detail.
- The hot-path code (the `/image.png` handler) shrinks dramatically: most of its body becomes
  `c.body(cache.get(currentToken))` plus 404 handling.
