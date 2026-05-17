# 0005 — HTTP layer: Hono, routing, and the dashboard at `/`

**Status:** Accepted

## Context

The **Server** speaks HTTP to three distinct consumers:

- **Device** — BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) and the rendered PNG it
  fetches from `/preview/png`.
- **CDP sidecar** — fetches `/preview` (and any `/assets/*` it references) when screenshotting.
- **Dashboard** (browser) — admin/debug surface at `/`, plus `/preview` and `/preview/png` for dev
  iteration on the Plugin.

We need an HTTP framework, a route layout that makes each consumer visible at a glance, and a place
for the dashboard.

## Decision

### Framework: Hono

[Hono](https://hono.dev) for HTTP routing. We already depend on `hono/jsx` for Plugin JSX rendering,
so adding `hono` for the HTTP framework half means one package instead of two. Small surface, fast,
native Deno support, clean middleware. The Conductor and Dashboard each expose a Hono sub-app
composed into the parent via `app.route("/", subApp)`.

### Route layout

| Route              | Used by             | Purpose                                                                                                              |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/setup`   | Device (first boot) | BYOS setup payload. `image_url` points at `/preview/png`.                                                            |
| `GET /api/display` | Device (each poll)  | Returns `image_url=/preview/png`, `filename` (HTML identity), `refresh_rate` (from `Result.validity`).               |
| `POST /api/log`    | Device              | Receives firmware logs.                                                                                              |
| `GET /`            | Browser             | Dashboard. Scrubs the Plugin at `?t=` and shows the live Image + Result metadata.                                    |
| `GET /preview`     | CDP, browser        | Live HTML of the Plugin's current output. Accepts `?t=` / `?intent=`. Status 500 when the pipeline error-falls-back. |
| `GET /preview/png` | Device, browser     | Live PNG of `/preview`, via CDP. The single render path — everyone hits the same code.                               |
| `GET /assets/*`    | CDP, browser        | Static files from the active Plugin's `assets/` directory.                                                           |

The Device's image fetch is plain `GET /preview/png` — no shelved-HTML internal URL, no per-
identity image route. ADR-0003 explains why one render path is enough; ADR-0004 explains why there's
no cached Image to serve from a separate endpoint.

### The dashboard at `/`

A single page with one interactive parameter: `t`. The dashboard runs the Plugin at the chosen `t`
(`intent="scrub"`) to surface Result metadata, and embeds the screenshot inline by handing
`fetchPngFromUrl` the URL `${internalOrigin}/preview?t=...` — the same hop CDP uses when the Device
fetches `/preview/png`.

The dashboard is a Plugin debugging surface. A Plugin whose `view` reads wall-clock looks identical
at every scrub position; a Plugin that computes `validity` against wall-clock has wrong timeline
ticks at non-current `t`. These bugs are silent under Device-only operation; the dashboard makes
them visible.

### Layout principles

- **Prefix discipline.** `/api/*` is BYOS. `/preview*` is the live render (HTML + PNG). `/assets/*`
  is static files. `/` is the dashboard.
- **The Device constructs no URLs.** It follows `image_url` from `/api/display`. The render path can
  move without firmware impact.
- **Internal vs. external is enforced by origin.** `INTERNAL_URL_ORIGIN` (CDP's view of the Server)
  and `PUBLIC_URL_ORIGIN` (the Device's view) can differ; `/preview/png` uses the internal origin
  when forwarding to CDP, and `/api/display` uses the public one when composing `image_url`.

## Consequences

- Reading the route table reveals what each consumer touches without commentary.
- Adding a new consumer (status/metrics endpoint, etc.) means picking a new prefix, not threading
  into an existing one.
- The dashboard, dev `curl`, and the Device share `/preview/png` — bugs reproduce in any of them.
- The dashboard at `/` adds a small attack surface (any LAN client can scrub Plugin state).
  Single-user posture (ADR-0001) accepts this; networks with untrusted clients should put a reverse
  proxy in front.
- Hono's `serveStatic` is sufficient for the single static prefix. If we ever need more (per-asset
  cache headers, etc.), a custom handler is one short function away.
