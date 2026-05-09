# 0001 — Service charter: runtime + proxy + render primitive

**Status:** Accepted — 2026-05-09

## Context

Today's `src/main.ts` collapses three independent concerns onto the device's
poll clock: it runs the user template, rasterizes via CDP, and dithers — all
on the hot path of `/image.png`. Adding new endpoints (preview, debug knobs,
render overrides) has thickened the file and made it unclear what the service
is actually responsible for vs. what the user template owns.

The user template is conceptually independent: it knows what to display, when
its content changes, and on what cadence the device should poll. The service
shouldn't dictate any of that.

## Decision

The service is responsible for, and only for:

1. **Runtime** — load the user template at boot and host it for the process
   lifetime.
2. **Non-prescription** — do not impose a lifecycle on user code. The user
   chooses when to compute frames.
3. **Proxy** — sit between TRMNL firmware and the user template; expose the
   BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`, `/image.png`).
4. **Device intel forwarding** — pass headers and identification (MAC/ID,
   panel size, etc.) from firmware to user code on each poll.
5. **Render primitive** — provide a `render(jsx)` function user code can call
   to turn a JSX tree into a device-ready PNG. User code never imports CDP,
   never invokes the dither module directly.

Everything else — *when* a frame is computed, *whether* it is pre-rendered or
computed lazily, *how* the user template stores intermediate state — is the
template's call.

## Consequences

- The HTTP routes split cleanly into three groups: BYOS device API, image
  serving, and (internal) CDP support. No more business logic in route
  handlers.
- The template clock, render clock, and device clock are decoupled. The
  service no longer mediates between them; it just connects them at the
  boundaries.
- Adding a new device model is a service change (registry of panel
  parameters), not a template change. Adding a new screen design is a
  template change, not a service change.
- The "preview" route (`/`) becomes ambiguous in this model — see ADR-0005.
