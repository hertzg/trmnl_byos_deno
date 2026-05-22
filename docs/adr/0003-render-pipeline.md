# 0003 — Render pipeline: Plugin → Bundle → Renderer → Image

**Status:** Accepted

## Context

The **Plugin** exposes `run(ctx) → Result`; the **Device** displays PNG bytes. The **Server** owns
the chain between them.

CDP (the headless-browser sidecar) is the only way we have to turn HTML into a panel-resolution PNG.
CDP can only screenshot URLs, not strings — so somewhere the Server has to host the HTML plus the
Plugin's assets on a URL CDP can fetch.

An earlier shape served the live HTML at a public `/preview` route and the PNG at a public
`/preview/png` route, with CDP fetching `/preview` over the Server's outward HTTP layer. The two
routes were shared by the Device, the dashboard, and dev `curl`. That worked, but it required two
Plugin runs per Device cycle (one inside `/api/display` for `filename`/`refresh_rate`, one inside
`/preview` for the screenshot), and it leaked Plugin assets onto a public `/assets/*` route that
nobody outside the render pipeline had a reason to hit.

## Decision

### Bundle is the unit the Renderer consumes

PluginManager produces a `Bundle = { result, assets }` per `run(ctx)` call. `assets` is the Plugin's
`assets/` directory in memory, keyed by `/assets/<path>` URL. The Bundle is everything the Renderer
needs — no separate filesystem reach-out, no public asset route.

### Renderer is one module

Two public methods, both stateless from the caller's perspective:

- `identity(bundle) → string` — derives HTML internally (`renderToString(view(state))`), hashes
  `(html + assets)`, returns the truncated hex digest. The Bundle's identity is the basis of the
  Slot's cache key and the Device's filename cache (ADR-0004).
- `rasterize(bundle) → Promise<Uint8Array>` — derives HTML internally, spins an internal loopback
  HTTP server that serves the HTML plus the Bundle's assets, hands CDP that internal URL,
  screenshots at the active panel's geometry, dithers, returns PNG bytes.

How CDP, the loopback server, and dither are wired together is encapsulated inside Renderer. Callers
do not see a "screenshot URL" surface; the Renderer manages its own internal origin.

HTML is derived twice per cycle for the same Bundle (once in `identity`, once in `rasterize`).
`renderToString` is microseconds; the duplication is not load-bearing. If profiling ever disagrees,
Renderer can memoize HTML per Bundle reference behind the same public surface.

### Slot caches the Image

The Slot (see ADR-0004) holds at most one entry: `{ bundle, identity, image, cachedAt }`. The
`image` is a `Promise<Uint8Array>` started eagerly when the entry lands. Subsequent fetches await
the same promise; once it resolves, it's available immediately.

### Conductor orchestrates one render per Device cycle

`GET /api/display`:

1. Parse the Device's heartbeat from request headers into `latestDevice`.
2. If `slot.display()` returns metadata, the cached Image is still valid — return its identity.
3. Otherwise: call `pluginManager.run(ctx)` → Bundle. Call `renderer.identity(bundle)` → identity.
   Call `renderer.rasterize(bundle)` → image promise (do not await). Call
   `slot.put({ bundle, identity, image })`. Return identity and the remaining validity.
4. Respond with
   `{ image_url: /image/<identity>.png, filename: image-<identity>, refresh_rate:
   ceil(remainingValidity.seconds) }`.

`GET /image/<id>.png`:

1. Call `slot.image(id)`. If it returns null (Slot empty, expired, or identity mismatch), respond
   404 — the Device's next `/api/display` will fetch fresh identity.
2. Otherwise await the bytes and return them with `content-type: image/png`.

There is no second Plugin run per cycle. The eager rasterize started in `/api/display` is the same
one `/image` awaits.

### Single render path, no shelf

`/image/<identity>.png` is the only route that produces PNG bytes for the Device. The dashboard
embeds `<img src="/image/<identity>.png">` for "what the Device is currently seeing" and hits the
same handler — same code, same Slot, same Renderer call path.

For arbitrary-`t` scrub previews, Dashboard has its own `GET /dashboard/preview.png?t=...` that
calls PluginManager + Renderer directly with a transient Bundle. The scrub path never touches the
Slot and never records to Telemetry.

### Identity-keyed URL

Per-Image URLs (`/image/<identity>.png`) replace the previous stable-URL pattern. Benefits:

- Filename and bytes are atomically paired through the URL itself. A request for `/image/X.png` can
  never accidentally receive bytes from a stale Image Y.
- Browser/intermediary caching just works — different identity = different URL.
- A stale request from a Device whose cache has drifted (rare; e.g. firmware restart mid-cycle)
  responds 404 rather than serving a mismatched Image; the Device's next `/api/display` corrects.

### Error fallback lives in Conductor's orchestration

Plugin throws inside `pluginManager.run`, Renderer throws inside `identity` (view-time JSX error),
or Renderer throws inside `rasterize` (CDP unreachable, dither failure, etc.). Conductor wraps the
orchestration loop in try/catch. On any throw:

1. Build an error Bundle from a server-supplied error-view component and a short `errorValidity`
   (~30s).
2. Re-run the orchestration loop with the error Bundle. The error Bundle goes through
   `Renderer.identity` and `Renderer.rasterize` like any other; it lands in the Slot like any other.
3. Return the error Bundle's identity. The Device sees the error view on the panel within one
   refresh cycle.

CDP-unreachable during a rasterize that's already past `Renderer.identity` (i.e. the entry is
already in the Slot with a pending image promise) is the one residual failure: `slot.image(id)`
returns a rejected promise. Conductor catches at the `/image/<id>.png` handler and responds 500; the
Device retries on its next poll, which re-enters the orchestration loop and may pick up the error
path then.

### Renderer internals are not part of the surface

Renderer's choice of CDP (`cloakbrowser` today) is one implementation detail of `rasterize`.
Panel-specific parameters (width, height, DPR, default bit depth, default dither mode) live in
`src/render/profiles.ts` and are passed in at Renderer construction. Adding a new panel model is a
registry entry plus a Renderer reconstruction, not a public-surface change.

## Consequences

- **One render path.** `/image/<identity>.png` serves the Device and the dashboard's "current Image"
  view from the same Slot entry. A bug in the rasterize step reproduces in the browser the moment
  the Slot rolls.
- **One Plugin run per Device cycle in the common case** (was two). The eager rasterize from
  `/api/display` is what `/image` awaits; on validity-hit polls, no Plugin run happens at all.
- **No outward `/assets/*` route.** The only thing serving Plugin assets is Renderer's internal
  loopback origin, reachable only by CDP. The asset surface is private by construction.
- **No `/preview` route.** The HTML CDP screenshots is served by Renderer's internal origin and has
  no public name. The dashboard's preview-of-the-current-Image is a PNG (`/image/...`), not an HTML
  page; an HTML-view debug affordance for Dashboard is deferred.
- **Renderer holds no state across renders.** The single-Image cache lives in Slot, not in Renderer.
  Renderer is constructed once with profile + CDP config and queried per render.
- **Adding device models is cheap:** a new entry in `src/render/profiles.ts`.
- **The Renderer is a black box from the Plugin's perspective.** Today its rasterize talks to CDP;
  tomorrow it could be anything that takes a Bundle and returns dithered PNG bytes.
