# 0005 — HTTP layer: Hono, routing, and the dashboard at `/`

**Status:** Accepted

## Context

The **Server** speaks HTTP to two distinct consumers:

- **Device** — BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) and the rendered PNG it
  fetches from `/image/<identity>.png`.
- **Dashboard** (browser) — admin/debug surface at `/`, plus `/dashboard/preview.png` for
  arbitrary-`t` scrub previews and `POST /dashboard/clear` for cache invalidation.

CDP (the headless-browser sidecar that screenshots Plugin output) is _not_ a public HTTP
consumer. Renderer spins its own loopback HTTP server inside the process to serve the Bundle
(HTML plus assets) to CDP; the loopback origin is not reachable from outside the Server.

We need an HTTP framework, a route layout that makes each consumer visible at a glance, and a
place for the dashboard.

## Decision

### Framework: Hono

[Hono](https://hono.dev) for HTTP routing. We already depend on `hono/jsx` for Plugin JSX
rendering, so adding `hono` for the HTTP framework half means one package instead of two. Small
surface, fast, native Deno support, clean middleware. The Conductor and Dashboard each expose a
Hono sub-app composed into the parent via `app.route("/", subApp)`.

### Route layout

| Route                       | Used by             | Owner     | Purpose                                                                                                                  |
| --------------------------- | ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/setup`            | Device (first boot) | Conductor | BYOS setup payload. `image_url` points at `/image/<identity>.png` (constructed once Device polls).                       |
| `GET /api/display`          | Device (each poll)  | Conductor | Returns `image_url=/image/<identity>.png`, `filename` (Bundle identity), `refresh_rate` (from `Result.validity`).        |
| `POST /api/log`             | Device              | Conductor | Receives firmware logs.                                                                                                  |
| `GET /image/<id>.png`       | Device, browser     | Conductor | Serves the Slot's current Image if `<id>` matches; 404 otherwise. The single render path — both Device and dashboard.    |
| `GET /`                     | Browser             | Dashboard | Admin page. Shows the current Image (`<img src="/image/<identity>.png">`), recent render trace, and a scrub-`t` form.    |
| `GET /dashboard/preview.png` | Browser             | Dashboard | Transient scrub render at `?t=…`. Calls PluginManager + Renderer directly; bypasses the Slot; does not write Telemetry. |
| `POST /dashboard/clear`     | Browser             | Dashboard | `slot.clear()` + redirect to `/`. Invalidates the cache; next request refills.                                           |

The Device's image fetch is `GET /image/<identity>.png` — identity-keyed, so the filename and
bytes are atomically paired through the URL. ADR-0003 explains why one render path is enough;
ADR-0004 explains the Slot's three-tier laziness.

There is **no public `/assets/*` route**. Plugin assets are bundled into each `Bundle` and
served by Renderer's internal loopback origin during CDP screenshot.

There is **no `/preview` HTML route**. The HTML CDP screenshots is served by Renderer's
internal loopback origin and has no public name. The dashboard's "what is the Device currently
showing" is a PNG embed (`/image/<identity>.png`), not a raw HTML view.

### Why identity-keyed PNG URLs

The Device's filename cache pairs `(filename, bytes)`. A stable URL (`/image.png` always
returning "whatever's current") could race: Device gets identity X from `/api/display`,
dashboard scrubs replace the Slot with identity Y, Device fetches `/image.png` and gets Y's
bytes labeled X.

With `/image/<identity>.png`:

- Filename and bytes are atomically paired through the URL itself; the race cannot mislabel.
- A request with stale `<id>` returns 404; the Device's next `/api/display` corrects.
- Intermediary caches (browsers, proxies) treat each Image as a distinct resource — no
  cache-busting query strings needed.

### The dashboard at `/`

A single page that visualizes the system state without participating in the Device's render
loop:

- **Current Image** — embedded `<img src="/image/<identity>.png">`, where identity comes from
  `slot.display()` (in-process read, no refresh trigger).
- **Render trace** — durations and identity from the most recent Conductor cycle, read from
  Telemetry. If the last cycle errored, the error message is part of the trace.
- **Scrub form** — `?t=…` input that posts to `/dashboard/preview.png` for a transient preview
  render at arbitrary time.
- **Clear button** — `POST /dashboard/clear` invalidates the Slot; page reloads; the reload's
  `slot.display()` returns null, the page triggers `/api/display` in-process (via
  `conductor.app.request(...)`) to refill, and shows the new Image.

The dashboard is a debug surface, not a Device entry point. A Plugin whose `view` reads
wall-clock looks identical at every scrub position; a Plugin that computes `validity` against
wall-clock has wrong timeline ticks at non-current `t`. These bugs are silent under Device-only
operation; the dashboard makes them visible.

### Layout principles

- **Prefix discipline.** `/api/*` is BYOS. `/image/*` is the render output. `/dashboard/*` is
  the dashboard's own routes. `/` is the dashboard page itself.
- **The Device constructs no URLs.** It follows `image_url` from `/api/display`. The route
  shape can change without firmware impact.
- **Internal vs. external is enforced by origin.** `INTERNAL_URL_ORIGIN` is reserved for
  legacy interop while Renderer's internal loopback origin is brought up; for the new
  pipeline, CDP only sees Renderer's loopback URL and never reaches the Server's outward HTTP
  layer.

## Consequences

- Reading the route table reveals what each consumer touches without commentary.
- Adding a new consumer (status/metrics endpoint, etc.) means picking a new prefix, not
  threading into an existing one.
- The dashboard's "current Image" preview and the Device's render fetch share
  `/image/<identity>.png` — bugs reproduce in either consumer.
- The dashboard at `/` adds a small attack surface (any LAN client can read the Slot's current
  identity, fetch the current Image, scrub the Plugin, or clear the cache). Single-user
  posture (ADR-0001) accepts this; networks with untrusted clients should put a reverse proxy
  in front.
- `POST /dashboard/clear` is unauthenticated. A malicious LAN client could spam it; impact
  is bounded (each clear forces one extra render on the next poll). Acceptable under
  ADR-0001.
- Hono's `serveStatic` is no longer needed — there are no public static routes. If we ever add
  one (e.g. dashboard CSS), it's one short handler.
