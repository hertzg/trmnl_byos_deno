# 0007 — Prerender warm-up ahead of Device wake

**Status:** Accepted

## Context

A Device poll has measurable wake-up latency before the **Server** is even reached: the Device
boots out of deep sleep, brings up Wi-Fi, completes DHCP, resolves DNS, opens the TLS connection,
and only then hits the BYOS endpoint. The **Conductor** sees the very last step.

If the **Current Result** has expired by the time the Device polls, the Conductor must run
`Plugin.run` → `deriveHtml` → (possibly) `rasterize` from cold while the Device waits — adding the
full render cost on top of the wake-up cost. The render is also the load-bearing flicker cost for
the Device (ADR-0004); making it conditional on the Device being awake means the Device's
perceived response is "wait for cold-render."

The wake-up window is large enough — seconds — to fit most of the render work, if the Conductor
prepares the next Image *before* the Device polls instead of reacting after.

## Decision

The **Conductor** schedules a **prerender warm-up** ahead of each Current Result's expiry:

1. After the Current Result becomes the current one (`t_committed`), the Conductor schedules a
   prerender at approximately `t_committed + validity - wake_window`, where `wake_window` is a
   conservative estimate of the Device's wake-up time (boot + Wi-Fi + TLS).
2. At that scheduled moment, the Conductor calls `Plugin.run({ t: near-future-t, intent:
   "prerender", device })` with `near-future-t` ≈ the moment the Device is expected to poll.
3. The prerender result runs through the normal pipeline (`deriveHtml`, identity check, possibly
   `rasterize`) and becomes the new Current Result + Current Image as soon as it completes.
4. When the Device's poll actually arrives, the Conductor returns the warm Current Image without
   doing render work in the request path.

If the prerender completes before the Device polls, the Device sees a warm response. If it doesn't
(prerender is slow, or the Device is early), the Device pays the normal cold-render cost — same
behavior as without prerendering. Worst case = current behavior; best case = no render in the
poll path.

`wake_window` is a Server-side constant tuned empirically. It is not exposed in the **Plugin**
contract; the Plugin does not know prerenders happen except that it sees `ctx.intent === "prerender"`
in `RunContext`.

### Dashboard scrubs and other triggers do not prerender

Prerendering targets the Device's polling cadence. A dashboard scrub is interactive and synchronous
from the dashboard's perspective; warming it ahead of time has no use. The Conductor schedules
prerender warm-ups only off the Device-poll trigger trail.

### Idempotence and concurrency

A prerender warm-up that finishes after the Device has already polled (Device was early) lands as
the next Current Image and serves the *next* poll. The Conductor de-duplicates: only one prerender
runs at a time per Plugin; a new schedule cancels any in-flight prerender that's now obsolete.

## Consequences

- **Device poll latency drops** by the render time in the common case. The wake-up cost is
  unchanged; what changes is whether render time stacks on top of it.
- **Plugin authors gain a third caller-kind to consider.** Most Plugins behave identically for
  `poll` and `prerender` — `intent` mainly matters for state-advancing Plugins (e.g. a "next photo"
  Plugin shouldn't advance the counter on a `prerender` and then advance again on the matching
  `poll`).
- **Conductor gains a scheduler.** A single per-Plugin scheduled task; nothing fancier than
  `setTimeout` is needed for the single-Device case.
- **The render budget per poll cycle is bounded.** Even with prerendering, the Conductor still does
  at most one render per validity window — `wake_window` simply shifts when that render happens.
- **Extending to multi-Device** (out of scope today, ADR-0006) would require per-Device prerender
  schedules; the contract supports this naturally because `ctx.device` already varies per Device.
