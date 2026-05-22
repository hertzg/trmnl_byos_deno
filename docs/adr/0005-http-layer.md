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
| `GET /`                     | Browser             | Dashboard | Admin page. Shows the current Image (`<img src="/image/<identity>.png">`), recent render trace, and the scrub timeline.    |
| `GET /dashboard/preview.png` | Browser             | Dashboard | Transient scrub render at `?t=…`. Calls PluginManager + Renderer directly; bypasses the Slot; does not write Telemetry. Returns the PNG plus the render's `identity` and `validity` as response headers. |
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
- **Scrub timeline** — a draggable timeline for previewing the Plugin at arbitrary `t`. See
  _The scrub timeline_ below.
- **Clear button** — `POST /dashboard/clear` invalidates the Slot; page reloads; the reload's
  `slot.display()` returns null, the page triggers `/api/display` in-process (via
  `conductor.app.request(...)`) to refill, and shows the new Image.

The dashboard is a debug surface, not a Device entry point. A Plugin whose `view` reads
wall-clock looks identical at every scrub position; a Plugin that computes `validity` against
wall-clock has wrong timeline ticks at non-current `t`. These bugs are silent under Device-only
operation; the dashboard makes them visible.

### The scrub timeline

The dashboard's scrub control is a draggable timeline, not a text field — so previewing the
Plugin at arbitrary `t`, and seeing how long each render stands, is direct manipulation rather
than guess-and-type.

- **Span and window.** The timeline shows a tunable span (1 / 3 / 6 / 12 / 24 h; default 3 h) of
  a chosen day. A day-overview strip pans the visible window; a date picker moves between days. A
  fixed 24 h window was rejected — at that scale a typical validity window is an invisible sliver.
- **Now tick and scrub head.** A fixed tick marks real `now`; a separate draggable scrub head
  picks the preview `t`. They start together and the head drifts as you drag.
- **Render on release.** Dragging the head moves only the head and its time label. The transient
  render fires once, on release — rasterize is 200–800 ms, so live re-rendering would only churn.
- **Cached window.** The Slot's current entry is drawn as a band from `cachedAt` to
  `cachedAt + validity` — the one span where a real Device poll is a Tier-1 hit. It is the only
  real Slot state on the timeline; everything else is a transient projection.
- **Validity bracket.** After a release render, that render's own `validity` is drawn as a
  bracket forward from the scrub head, making variable validity visible (a Plugin whose
  `validity` shrinks the later in an interval it is asked, or runs long over a quiet period). The
  bracket and every render-derived readout — identity, "matches cache", projected `/api/display`
  — describe the _last completed render_. They are not computed mid-drag: the client cannot know
  validity or identity without a render.
- **Always transient.** Every scrub render is transient — fresh at `t`, as if the Slot were
  invalidated and rebuilt at that instant. The preview never serves the cached Image, even when
  the scrub head sits inside the cached window; a "matches cache" hint flags when the transient
  render's identity coincides with the cached one. The preview answers "what would the Plugin
  produce at `t`"; "what is the Device showing now" stays the separate Current Image panel.
- **Projected `/api/display`.** A panel shows the JSON a Device would receive for a poll that
  renders fresh at the scrub head — `image_url`, `filename`, `refresh_rate` (the render's
  `validity` in whole seconds) — derived from that same transient render.

`/dashboard/preview.png?t=` carries the render's `identity` and `validity` back as response
headers; the client `fetch`es it once and reads both from the response. The timeline is the
dashboard's first client-side JavaScript — inline in the page, the way its CSS is. This does not
weaken the "no implicit HTML injection" cornerstone: that governs _Plugin_ HTML, and the
dashboard is the Server's own debug surface, not a Plugin.

#### Rejected alternatives

- **Pre-walking the day into a render chain.** The timeline could run the Plugin forward across
  the window, chaining validity boundaries into segments, to show the day's display schedule up
  front. Rejected: one Plugin run per segment (hundreds during a short-validity window), and a
  run at a future `t` is live re-simulation, not history — the Server holds exactly one Image, no
  past or future ones. The per-position validity bracket surfaces the same "how long does this
  stand" without the cost or the pretence.
- **An activity-weighted (non-linear) axis.** Stretching busy parts of the day would make short
  validity windows easier to grab. Rejected: the dashboard cannot know a Plugin's activity
  profile ahead of time — it is revealed only by running the Plugin, and Plugin behaviour varies
  too widely (time-agnostic, predictable, push-based). A linear axis plus a tunable span is
  honest about what is knowable.
- **Serving the cached Image inside its validity window.** When the scrub head sits inside the
  cached window the preview could serve the real cached Image for free. Rejected: the preview
  would then mean two different things by position. It always means "what the Plugin produces at
  `t`"; the "matches cache" hint and the Current Image panel carry the cache story.

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
- The dashboard now ships client-side JavaScript (the scrub timeline) — inline in the page, the
  same way its CSS is. Still no public static route.
