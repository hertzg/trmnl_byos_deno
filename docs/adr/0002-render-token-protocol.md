# 0002 — Token-based render protocol between service and template

**Status:** Superseded by ADR-0006 (#13) — the template-side render
primitive (`services.renderJsx`) and content-addressed token protocol
this ADR defined no longer exist. Templates now return declarative
frames; the service coordinates rendering. Token-as-PNG-hash is
replaced by job-id correlation. See ADR-0006 for the full rationale.
**Related:** ADR-0001 (charter), ADR-0003 (module shape, also revised),
ADR-0006 (successor)

## Context

Following ADR-0001, the service must expose a render primitive the template
calls without coupling to "when" frames are produced. Two extremes were
rejected:

- **Service-pulls-JSX-on-every-poll** — couples render cost to the device
  clock; pre-rendering is impossible without service-side scheduling.
- **Template-pushes-bytes-on-its-own** — service has no way to know whether
  any frame exists yet; first-poll behavior is unspecified.

We need a handoff that lets the template choose its own moment to render
*and* lets the service serve quickly when the device asks.

## Decision

The seam between user code and service is a **token**. The service exposes:

```ts
services.renderJsx(jsx, opts?): Promise<Token>
```

- `services.renderJsx` performs the full pipeline (JSX → HTML → CDP rasterize →
  dither → PNG) **synchronously**: the returned promise resolves only after
  the bytes are in the cache. Rasterization errors throw to the caller, where
  the user can handle or fall back.
- `Token = string`, derived from the **hash of the resulting PNG bytes**.
  Same input → identical bytes → identical token. Repeat calls dedupe by
  refreshing LRU position.
- The service stores tokens in a bounded **LRU cache, capacity 16**. Both
  inserts and reads touch the entry's recency.

The user template then returns a token (any token previously obtained from
`services.renderJsx`) when polled by the service. The service inlines that
token into the `image_url` returned to the device; `/render/:token` looks
up the bytes directly from the cache.

Iteration 1 scope: input is JSX-only (no raw bytes path, no HTML string
input). Stage-2 parameters (bit depth, dither algorithm) are
service-internal and not user-overridable.

## Consequences

- **Pre-render and lazy converge to one API.** Lazy: call `renderJsx`
  inside the display handler. Pre-render: call `renderJsx` at boot or on
  a timer, hold the token. The service treats both identically.
- **Token = content hash** means rendering the same thing twice is honest —
  the second call still pays the rasterization cost, but the cache slot is
  shared. We accepted this over input-hashing because hashing JSX trees
  reliably is hard and the simplification is worth the wasted CPU on
  redundant renders.
- **Sync resolution** means the user template — not the device handler —
  owns error recovery. Errors land where they happen. A template that wants
  to never fail can `try { token = await services.renderJsx(...) } catch
  { token = lastKnownGood }`.
- **LRU(16)** is sufficient for the single-device case and the
  pre-rendering patterns we expect (one or a few rotating frames). Templates
  that produce more than 16 distinct frames in flight at once will see
  evictions; that's the template's bug, not the service's.
- **Stateless device path.** With the token in the URL path
  (`/render/:token`), the service holds no per-request state for the
  device. `/api/display` is a pure read of `onDisplay`'s output.
- Internal CDP-fetches-back-HTML seam (`/preview/:stashKey`) is an
  implementation detail of `services.renderJsx` — never exposed to user
  code. The stash key (UUID) is intentionally distinct from the
  user-facing token (sha-256 hex).
