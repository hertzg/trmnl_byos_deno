# 0007 — Prerender warm-up ahead of Device wake

**Status:** Withdrawn

Prerendering targeted a server-side Current Image cache that no longer exists. ADR-0004 removes the
cache: every Device fetch live-renders through `/preview/png`, so there is nothing to warm before
the Device polls. The render happens inside the Device's request path; the Device's own wake-up
latency dominates that cost.

If a server-side cache ever comes back, this idea is worth revisiting — the original framing below
is preserved for that future conversation.

---

## Original context

A Device poll had measurable wake-up latency before the **Server** was even reached: the Device
boots out of deep sleep, brings up Wi-Fi, completes DHCP, resolves DNS, opens the TLS connection,
and only then hits the BYOS endpoint. The **Conductor** saw the very last step.

If the **Current Result** had expired by the time the Device polled, the Conductor had to run
`Plugin.run` → `deriveHtml` → (possibly) `rasterize` from cold while the Device waited — adding the
full render cost on top of the wake-up cost. The wake-up window was large enough — seconds — to fit
most of the render work, if the Conductor prepared the next Image _before_ the Device polled instead
of reacting after.

## Original decision

The **Conductor** would schedule a **prerender warm-up** ahead of each Current Result's expiry:

1. After the Current Result became the current one (`t_committed`), the Conductor scheduled a
   prerender at approximately `t_committed + validity - wake_window`, where `wake_window` was a
   conservative estimate of the Device's wake-up time.
2. At that scheduled moment, the Conductor called
   `Plugin.run({ t: near-future-t, intent: "prerender", device })`.
3. The prerender result ran through the normal pipeline and became the new Current Result + Current
   Image as soon as it completed.
4. When the Device's poll actually arrived, the Conductor returned the warm Current Image without
   doing render work in the request path.

This relied entirely on the Conductor holding a Current Image keyed by identity. ADR-0004 withdrew
that mechanism; this ADR is withdrawn with it.

`ctx.intent === "prerender"` remains in the `RunContext` type for now — Plugins are free to ignore
it, and removing it is a contract change deferred until we're sure no Plugin is using it.
