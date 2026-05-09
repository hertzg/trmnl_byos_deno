# 0008 — Content-derived `filename` to skip device-side e-ink refresh

**Status:** Accepted — 2026-05-09 **Related:** ADR-0006 (frame coordinator), ADR-0002 (superseded
token protocol)

## Context

The TRMNL firmware caches downloaded images in SPIFFS keyed by the `filename` field of the
`/api/display` response, not by `image_url`. On each wake the device runs `fixFileName` over the
returned filename and compares against `szPrevFile` (RTC-persistent across deep sleep). When the
filenames match, the device:

1. skips the HTTP download entirely,
2. skips reading the file back from SPIFFS,
3. skips the e-ink refresh.

This avoids both bandwidth and a panel-refresh cycle (the latter is the dominant power cost on a
battery device, and contributes to e-ink ghosting/wear).

ADR-0006 mints a fresh UUID per render and the response previously emitted
`filename: "image-${jobId}"`. Consequence: every validity-window expiration produced a new filename,
so the device always re-downloaded and always refreshed the panel — even when the rendered output
was pixel-identical to the previous frame.

ADR-0006's reasoning for choosing UUIDs over content-addressed tokens (which ADR-0002 had used) was
that **post-CDP** dedup didn't recover enough work to justify the complexity. That reasoning stands:
the coordinator continues to render on every validity expiry; it does not skip CDP based on input
identity. What's added here is a device-facing identifier that is independent from the server's
render-correlation identifier.

The firmware-side constraint shape (from `fixFileName` in `bl.cpp`):

- `szPrevFile[36]`, `szTemp[36]` — comparison buffers.
- SPIFFS hard cap: `'/' + 31 chars + '\0'`.
- If src ≤ 31 chars: prepend `/`, use as-is.
- If src > 31 chars: keep first 7 + last 17 (assumes a `prefix-id-timestamp` shape that is not
  ours).

Staying ≤ 31 chars avoids the asymmetric truncation path entirely.

## Decision

The `/api/display` `filename` field is derived from the **input HTML** of the current frame, not
from the jobId.

```
filename = `image-${sha256(html).hex.slice(0, 16)}`
```

- 16 hex chars = 64 bits of entropy. Collision-free at any plausible fleet × frame count.
- `image-` (6) + 16 = 22 chars total. Under the firmware's 31-char SPIFFS limit, so `fixFileName`
  takes the as-is branch.
- The hash is computed from the rendered HTML (output of `renderToString` over the `onDisplay` JSX),
  not from the JSX object directly. HTML is the canonical, already-stringified form and is what CDP
  rasterizes; hashing it sidesteps JSX-serialization concerns.
- The hash is stored on `Job` (alongside `html` and `png`) and surfaced on `CurrentFrame` so
  `/api/display` can read it without an LRU lookup.

`jobId` remains a UUID per ADR-0006. It still keys the LRU, the CDP fetch-back URL
(`/preview/:jobId`), and the device-fetched PNG URL (`/preview/:jobId/png`). `image_url` is
unchanged. The two identifiers serve different concerns:

- **`jobId` (UUID)** — server-internal render correlation, LRU key, ephemeral lifetime.
- **`contentHash` (sha256-hex-16)** — device-facing pixel identity, stable across renders that
  produce identical input HTML.

## Consequences

- **Power and refresh savings on the device.** When `onDisplay` returns the same JSX across validity
  windows (data hasn't changed; e.g., HN top stories during a quiet hour), the device sees the same
  filename, hits its SPIFFS cache, and skips the e-ink refresh. With validity 60s and unchanged
  data, a TRMNL X battery saves both the modem-fetch and the panel-refresh per cycle.
- **No server-side render skip.** The coordinator still calls CDP on every validity expiration,
  consistent with ADR-0006. Adding a pre-render input-hash cache is a separate (deferred) decision;
  doing it correctly requires fingerprinting CSS, fonts, and dither config in addition to JSX, and
  the savings are small relative to validity-based cadence.
- **Tradeoff: external mutable assets are not detected.** If a template embeds an external URL whose
  body mutates while the URL stays stable (e.g. `<img src="https://cdn/avatar.jpg">` whose bytes
  change), the input HTML is unchanged and the contentHash collides — the device would skip a
  legitimately-changed render. Templates are expected to either inline mutable image bytes as
  data-URIs in the JSX or accept this limitation. The HN example and TRMNL framework templates do
  not embed mutable external assets.
- **CSS / framework changes are caught at server-restart granularity.** Production deploys are
  atomic; dev uses `--watch`, which restarts the server (wiping the LRU and resetting the
  contentHash baseline). A mid-session CSS edit cannot serve stale pixels because the server has
  restarted.
- **`Job` and `CurrentFrame` carry an extra string field.** Trivial cost. Existing
  `/preview/:jobId(/png)` routes are unaffected.

## Notes

- Hashing the HTML rather than the JSX is a pragmatic choice: JSX has no canonical serialization
  (prop order, fragment nesting, inline `style={{...}}` object identity), HTML does.
  `renderToString` is deterministic over a given JSX tree under our runtime, so hashing HTML
  preserves the "same input → same hash" property without requiring a custom JSX serializer.
- The firmware's `RTC_DATA_ATTR char szPrevFile[36]` is preserved across deep sleep but lost on full
  reboot. That's a device-side constraint; it doesn't affect this decision but explains why the
  optimization recovers gradually after a hard reset.
- ADR-0007's reservation of "UUIDs and sha-256-hex tokens" in the `:jobId` slot was anticipatory.
  This ADR does not consume that affordance — `jobId` remains UUID-only. Future work that wants
  content-hash routes can add `/preview/by-content/:hash` without colliding with the literal `png`
  segment guard.
