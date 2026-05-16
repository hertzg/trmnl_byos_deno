# 0005 — HTTP layer: Hono, routing, and the dashboard at `/`

**Status:** Accepted

## Context

The **Server** speaks HTTP to four distinct consumers:

- **Device** — BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) and the **Image** bytes.
- **CDP sidecar** — internal fetch-back of HTML during rasterization (ADR-0003).
- **Dashboard** (browser) — admin/debug surface at `/`.
- **Plugin assets** — static files referenced by Plugin HTML.

We need an HTTP framework, a route layout that makes each consumer visible at a glance, and a place
for the dashboard.

## Decision

### Framework: Hono

[Hono](https://hono.dev) for HTTP routing. We already depend on `hono/jsx` for Plugin JSX rendering,
so adding `hono` for the HTTP framework half means one package instead of two. Small surface, fast,
native Deno support, clean middleware. A `createApp(deps)` factory returns a Hono instance fully
wired to its dependencies so tests can construct an app with stubs.

### Route layout

| Route                       | Used by             | Purpose                                                                                                                                                                    |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/setup`            | Device (first boot) | BYOS setup payload.                                                                                                                                                        |
| `GET /api/display`          | Device (each poll)  | Returns `image_url`, `filename` (Image identity), `refresh_rate`.                                                                                                          |
| `POST /api/log`             | Device              | Receives firmware logs.                                                                                                                                                    |
| `GET /images/:identity/png` | Device              | The PNG bytes for an **Image**. Cached by the Device against `filename`.                                                                                                   |
| `GET /`                     | Browser             | Dashboard. Hands the Conductor a `{ t, intent: "scrub", device }` trigger and previews the resulting Image. Does not touch the Current Result or Current Image.            |
| `GET /preview`              | Browser             | Live HTML of the current Plugin output for dev iteration. No CDP cost.                                                                                                     |
| `GET /preview/png`          | Browser             | Live PNG of the current Plugin output for dev iteration. Full pipeline.                                                                                                    |
| `GET /preview/:id`          | Renderer (internal) | HTML fetch-back during rasterization. Not reachable by the Device.                                                                                                         |
| `GET /assets/*`             | CDP, browser        | Static files from the active Plugin's `assets/` directory.                                                                                                                 |

### The dashboard at `/`

A single page with one interactive parameter: `t`. Forward-only scrubber; default `t` is the
**Current Result**'s commit moment. If no Current Result exists yet, the dashboard issues a scrub
trigger at `now` via the Conductor and treats the resulting Image as the preview — substituting
for the first Device poll without becoming the Current Result.

The dashboard is also a Plugin debugging surface. A Plugin whose `view` reads wall-clock looks
identical at every scrub position; a Plugin that computes `validity` against wall-clock has wrong
timeline ticks at non-current `t`. These bugs are silent under Device-only operation; the dashboard
makes them visible.

### Layout principles

- **Prefix discipline.** `/api/*` is BYOS. `/images/*` is Device-fetched bytes. `/preview/*` is dev
  iteration + CDP fetch-back. `/assets/*` is static files. `/` is the dashboard.
- **The Device constructs no URLs.** It follows whatever the Server gives it in `/api/display`. The
  Image path can move without firmware impact.
- **Internal vs. external is enforced by origin.** `INTERNAL_URL_ORIGIN` (CDP's view of the Server)
  and `PUBLIC_URL_ORIGIN` (Device's view) can differ.

## Consequences

- Reading the route table reveals what each consumer touches without commentary.
- Adding a new consumer (status/metrics endpoint, etc.) means picking a new prefix, not threading
  into an existing one.
- The dashboard and Device share `Plugin.run(ctx)` semantics — both are Conductor triggers at
  different `t` values, distinguished by `ctx.intent` (`"scrub"` vs `"poll"`).
- The dashboard at `/` adds a small attack surface (any LAN client can scrub Plugin state).
  Single-user posture (ADR-0001) accepts this; networks with untrusted clients should put a reverse
  proxy in front.
- Hono's `serveStatic` is sufficient for the single static prefix. If we ever need more (per-asset
  cache headers, etc.), a custom handler is one short function away.
