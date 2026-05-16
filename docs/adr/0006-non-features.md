# 0006 — Explicit non-features

**Status:** Accepted

## Context

A small contract earns its smallness by being explicit about what's _deliberately_ missing. Several
features have been proposed during design and rejected — not because they're bad ideas, but because
they would prematurely shape the **Plugin** contract or the wire layer for use cases we don't have
yet.

Without an explicit rejection record, these tend to creep back in incrementally.

## Decision

The following are deliberately not in the **Plugin** contract or the wire layer:

### Render-parameter overrides on Device-facing routes

No `?width=&height=&dpr=&bitDepth=&dither=` query overrides. Stage-2 rendering parameters live in
the device-profile registry; the **Plugin** does not control them and the Device doesn't either.
Adding new panels happens in the registry, not in URL parameters.

### `DisplayKind = "preview" | "device"` flag in the contract

A previous shape passed a `kind` flag into the template so it could branch on cosmetic differences
(e.g. show "(preview)" when called from the dashboard). With `snapshot(t)` + `present(sample)`,
there is no caller-intent in the contract. A Plugin cannot distinguish a Device poll from a
dashboard scrub. Honoring `t` correctly is enough; rendering should not depend on _who_ is asking.

Scoped rejection: the specific `kind` flag is out. The more general "should a future Plugin ever
know whether it's being asked for a real poll vs. a scrub" remains genuinely open (see `CONTEXT.md`
"Open questions"). What's rejected today is bolting that distinction into the contract
prophylactically.

### A `services` bag of Server-side helpers

Earlier shapes injected a `services` object into Plugin setup with helpers like `renderJsx(jsx)` or
`getDevice()`. These are not part of the contract. The factory receives a single config blob from
the **Server** (ADR-0002); what it deliberately does not receive is a bag of Server-side helpers,
device-state accessors, or render primitives. The Plugin's data layer is the Plugin's concern.

### Per-Plugin lifecycle hooks beyond the factory

No `start()` / `stop()` / `onDevice()` / `onPoll()` / `onButton()` on the **Plugin** interface.
Activation is the factory call; teardown is process exit. Push-handlers for ambient signals
(DeviceReport, button presses) are deferred until a concrete Plugin needs them — at which point they
will be added as auxiliary surfaces, not as core contract methods.

### Server-side multi-Plugin orchestration

The **Server** orchestrates exactly one Plugin. No Plugin registry, no schedule, no priority list,
no fallback chain. Multi-mode displays are achieved by a Super-Plugin (ADR-0002) composing other
Plugins as plain code — the orchestration logic lives in user code, where it can be as simple or as
elaborate as the author wants.

## Consequences

- The hot-path routes stay simple. No query-parameter parsing, no validation surface.
- The Plugin contract is uniform across consumers. Same `snapshot(t)` call for Device, dashboard,
  future tools.
- Future opt-ins are explicit additions when concrete pressure arrives — not retrofits to undo
  today's defaults.
- The "small contract" property of ADR-0002 is preserved by this record of what was kept out.
