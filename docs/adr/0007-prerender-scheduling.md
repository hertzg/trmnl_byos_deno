# 0007 — Prerender warm-up ahead of Device wake

**Status:** Withdrawn

Prerendering targeted a Device-wake-latency window during which the **Conductor** could pre-run
the render pipeline into a server-side cache, so the Device's poll arrived to warm bytes
instead of triggering a cold render. The current cache model (ADR-0004) makes this redundant:

- The Slot holds the most-recent Image until `validity` expires. While the Slot is valid,
  Device polls do **no** render work (Tier 1) — there is nothing to "warm" because the bytes
  are already there.
- When validity expires, the Conductor's orchestration loop runs the Plugin and starts the
  rasterize eagerly during `/api/display`; the Device's subsequent `/image/<identity>.png`
  fetch awaits the same promise. The render happens during `/api/display`, not during the
  image fetch — the Device-wake-latency window the prerender idea wanted to use is now used
  by the render itself, transparently.

If a future workload genuinely benefits from pre-warming (e.g. a Plugin whose render is so
expensive it dominates the Device's wake-latency budget), the right shape is most likely a
timer that calls Conductor's refresh path slightly before the Slot's `validity` expires.
That's a small addition to Conductor; it does not require a separate ADR or a separate
caching model.

`ctx.intent` was originally extended with `"prerender"` to let Plugins distinguish a
warm-up call from a real poll. That value is no longer in the contract — `RunContext.intent`
is `"poll" | "scrub"` (see ADR-0002). If pre-warming returns and Plugins need to distinguish
it, the value can be added back non-breakingly.

---

## Original context (preserved for reference)

A Device poll had measurable wake-up latency before the **Server** was even reached: the Device
boots out of deep sleep, brings up Wi-Fi, completes DHCP, resolves DNS, opens the TLS
connection, and only then hits the BYOS endpoint. The **Conductor** saw the very last step.

If the **Current Result** had expired by the time the Device polled, the Conductor had to run
`Plugin.run` → `deriveHtml` → (possibly) `rasterize` from cold while the Device waited —
adding the full render cost on top of the wake-up cost. The wake-up window was large enough —
seconds — to fit most of the render work, if the Conductor prepared the next Image _before_
the Device polled instead of reacting after.

## Original decision

The **Conductor** would schedule a **prerender warm-up** ahead of each Current Result's expiry:

1. After the Current Result became the current one (`t_committed`), the Conductor scheduled a
   prerender at approximately `t_committed + validity - wake_window`, where `wake_window` was
   a conservative estimate of the Device's wake-up time.
2. At that scheduled moment, the Conductor called
   `Plugin.run({ t: near-future-t, intent: "prerender", device })`.
3. The prerender result ran through the normal pipeline and became the new Current Result +
   Current Image as soon as it completed.
4. When the Device's poll actually arrived, the Conductor returned the warm Current Image
   without doing render work in the request path.

This relied on a particular caching shape (single-image cache invalidated only by HTML hash
change, plus a separately-scheduled warm-up). The current cache model (ADR-0004) achieves the
same "no work in the request path" property without a scheduler: validity-tier hits cost
nothing, and identity-change hits do the work eagerly in `/api/display` rather than waiting
for `/image/<id>.png`.
