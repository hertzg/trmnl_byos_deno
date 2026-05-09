# 0006 — Frame coordinator: single-flight, validity-driven, job-id correlation

**Status:** Accepted — 2026-05-09
**Supersedes:** ADR-0002
**Related:** ADR-0001 (charter), ADR-0003 (template module shape), ADR-0007 (preview URL namespace)

## Context

ADR-0002 made the template the renderer: it called `services.renderJsx(jsx)`
and returned a token. Tokens were sha-256 of the resulting PNG bytes;
`/render/:token` served them. Pre-render and lazy patterns converged on
"return a token from `onDisplay`."

Two pressures pushed against this:

1. **Per-device polls were independent.** Two devices polling at the same
   moment computed their own JSX, called `renderJsx` independently, paid
   CDP cost twice. Content-addressed dedup happened *after* CDP — only
   the cache slot was shared.
2. **Templates had to thread a render API through their code.** They
   imported `Services`, awaited `services.renderJsx`, returned a string
   token they didn't construct. The contract was imperative when it
   could have been declarative.

Concretely, with 1–10 devices polling at 60s, the post-CDP dedup never
recovered enough work to justify the architectural complexity it
demanded.

## Decision

The service is the **frame coordinator**. The template returns
declarative frames; the service decides when (and whether) to render.

```ts
type Frame = { jsx: unknown; validForSeconds: number };
type OnDisplayFn = () => Frame | Promise<Frame>;
```

The coordinator owns three pieces of state, all in a factory closure
(no module-level globals):

- `current: CurrentFrame | null` — the canonical frame all devices share.
  `CurrentFrame = { jobId, validUntil }`.
- `inFlight: Promise<CurrentFrame> | null` — an in-progress render that
  concurrent callers await (single-flight coalescing).
- `jobs: LruCache<jobId, { html, png? }>` — bounded history (capacity 16)
  keyed by UUID, populated in two phases (HTML before CDP, PNG after).

`ensureFrame()` is the read path:

1. If `current.validUntil > now`, return `current`. No work.
2. Else if `inFlight` exists, return it. Concurrent waiters all resolve
   to the same frame.
3. Else start a render: call `onDisplay`, render JSX → HTML, stash under
   `jobId`, hand CDP `${origin}/preview/${jobId}` (it fetches HTML back),
   dither, store PNG, set `current`, clear `inFlight`.

`refresh_rate` returned to the device is **derived**:
`max(1, ceil((validUntil - now) / 1000))`. Templates declare validity;
service derives polling cadence.

**Job IDs replace content-addressed tokens.** Each render mints a UUID.
The same UUID identifies (a) the HTML stash CDP fetches mid-render,
(b) the PNG bytes the device fetches post-render at
`/preview/:jobId/png`, (c) the dev tool's addressed URLs. No content
hashing; no pre-CDP dedup. Cleanup is LRU eviction only — no
`finally`-delete state.

**Errors at any pipeline stage** fall through to a service-supplied
`errorJsx` (typically the project's `ErrorCard`). The error frame is
cached as `current` with a short validity (default 30s). All in-flight
waiters resolve to that frame. If the error frame *itself* fails to
rasterize, the error propagates — `/api/display` returns 500 and the
operator pages on logs. No second-level fallback.

## Consequences

- **Templates become declarative.** No `Services` import. No `await`.
  No tokens to thread. `onDisplay` returns "what to display, and how
  long it stays valid."
- **CDP load scales with frame turnover, not fleet size.** With
  validity 60s and 10 devices polling every 60s, that's ~1 render/min,
  regardless of fleet size. Single-flight coalescing makes this true
  even when polls cluster.
- **Concurrent polls always agree.** The fleet sees the same canonical
  frame within a validity window. No per-device branching is possible —
  if it were, the rendered output would lie about device identity.
- **Cache state has one shape.** One `LruCache<jobId, Job>`, two-phase
  populate, capacity-based eviction. Replaces the previous (token-cache
  + ephemeral stash) split.
- **Per-device context goes away.** `OnDisplayContext` is deleted from
  the template surface. Templates that want time use `new Date()`;
  templates that want device class capture it from the setup-time
  `SetupConfig`. See ADR-0003 (revised).
- **Pre-render templates still work without ceremony.** Cache JSX in
  `setup`'s closure; `onDisplay` returns the cached JSX. Same coordinator
  behavior — the JSX is rendered to HTML each `ensureFrame` (a few ms),
  but rasterization runs only once per validity window.
- **The template-side `services` API is removed entirely.** This is the
  key reason ADR-0002 is superseded rather than amended: the surface it
  defined no longer exists. The render primitive `services.renderJsx` is
  internal to the coordinator and never exposed.

## Notes on what didn't change

- The BYOS HTTP contract (`/api/setup`, `/api/display`, `/api/log`,
  device-facing image URL) is unchanged in shape; only the URL pattern
  for the device-facing image moved.
- The CDP fetch-back seam still exists (CDP retrieves HTML over HTTP);
  it's now `/preview/:jobId` (see ADR-0007).
- Error rendering still produces a real frame — just one with short
  validity and short retry.
