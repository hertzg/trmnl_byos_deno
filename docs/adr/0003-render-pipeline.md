# 0003 — Render pipeline: Plugin → HTML → live screenshot

**Status:** Accepted

## Context

The **Plugin** exposes `run(ctx) → Result`; the **Device** displays PNG bytes. The **Server** owns
the chain between them.

The Server runs a headless browser (CDP / cloakbrowser) to turn HTML into a panel-resolution PNG.
CDP can only screenshot a URL, not a string — so the Server has to host the HTML somewhere CDP can
fetch.

## Decision

### One HTTP path covers both the dev-iteration preview and the Device-facing render

`/preview` returns the Plugin's live HTML. `/preview/png` is the same render, screenshotted live: on
every request it hands CDP the internal URL of `/preview` (with whatever `?t=` / `?intent=` query
the caller passed) and returns the resulting PNG. There is no shelved-HTML / internal-route
back-channel — `/preview` is just an ordinary route CDP fetches like any other URL on the Server.

The Device fetches `/preview/png` directly. `/api/display`'s `image_url` field points there.

### Per-poll pipeline

On `GET /api/display`:

1. Record the Device's heartbeat from the request headers into `latestDevice` (so the next Plugin
   run sees an up-to-date `ctx.device`).
2. Call `Plugin.run({ t: now, intent: "poll", device: latestDevice })`.
3. Derive HTML and identity. The identity becomes `filename`; `validity` becomes `refresh_rate`.
4. Respond with `image_url = ${publicOrigin}/preview/png`.

On `GET /preview/png` (the Device's next call):

1. Hand CDP `${internalOrigin}/preview` (forwarding any `?t=` / `?intent=` query).
2. CDP fetches `/preview`, which runs the Plugin again, derives HTML, and returns it.
3. CDP screenshots; the dithered PNG comes back.
4. Respond with the PNG bytes.

Two Plugin runs per Device cycle is the cost — one inside `/api/display` (for `refresh_rate` +
`filename`) and one inside `/preview` (for the actual pixels). At the polling cadences this Server
is tuned for (minutes), the extra run is invisible.

### Error fallback

If `Plugin.run` / `deriveHtml` / `identityFor` throws inside the Conductor's `derive`, the Conductor
swaps in a Server-supplied error view as a Result with the configured short validity (~30s).
`/api/display` and `/preview` both surface the error view that way. `/preview` flips its status to
500 so dev iteration tools see the failure.

If CDP itself fails (browser down, network error to the sidecar), `/preview/png` propagates the
error to the caller — the Device retries on the next poll. There is no synthesised "error PNG"
because synthesising one would also need CDP.

### Conductor surface

`derive(t, intent?) → { result, html, identity, device, error }`. That plus the BYOS sub-app
(`/api/setup`, `/api/display`, `/api/log`, `/assets/*`) is the full Conductor surface. No
`render()`, no `committedState()`, no `currentImage` — see ADR-0004 for the deliberate "no cache"
framing.

### Renderer is internal and stateless

Two functions:

- `deriveHtml(result) → string` — invokes `result.view(result.state)`, runs `renderToString`,
  prefixes `<!DOCTYPE html>`.
- `fetchPngFromUrl(url) → Promise<Uint8Array>` — talks to CDP, screenshots the URL at the active
  panel's geometry, dithers, returns PNG bytes (color-type=0, packed per the panel's bit depth).

`deriveHtml` is owned by the Conductor (it composes with `identityFor` for `filename`).
`fetchPngFromUrl` is owned by the Dashboard sub-app (`/preview/png` is the only consumer). Both are
pure functions of their inputs; neither carries instance state.

Panel-specific parameters (width, height, DPR, default bit depth, default dither mode) live in
`src/render/profiles.ts`. Adding a new panel model is a registry entry, not service code.

## Consequences

- **One render path.** `/preview/png` serves the dashboard, dev `curl`, and the Device — all the
  same code. A bug in the Device-facing render reproduces in the browser instantly.
- **No shelf, no `/__internal/render/:id`.** CDP fetches `/preview` like any other client.
- **The Plugin runs twice per Device cycle.** Acceptable at minute-scale polling; revisited if
  Plugins ever become expensive.
- **No "what the Device sees right now" state to inspect.** Every fetch is fresh; there is nothing
  pinned. See ADR-0004 for why that's the chosen trade.
- **Adding device models is cheap:** a new registry entry, no service changes.
- **The Renderer is treated as a black box from the Plugin's perspective.** Today its
  `fetchPngFromUrl` talks to CDP / cloakbrowser; tomorrow it could be anything that takes a URL and
  returns dithered PNG bytes.
