# 0008 — Project-native design system, framework-informed

**Status:** Accepted

## Context

**Plugins** need a shared visual vocabulary — Layout, typography, chrome (status bar, battery
indicator) — or every Plugin re-derives the same e-ink defaults. The Berlin-departures Plugin
(`templates/example/`) carries ~700 lines of CSS, of which a meaningful slice is generic
typography and chrome that any next Plugin would also need.

TRMNL ships an official Design Framework (https://trmnl.com/framework/docs) that solves much of
this problem for plugin-marketplace authors. It is opinionated, well-researched on e-ink
physics (no shadows, no gradients, no opacity, dither rules for photos), and prescribes a
class-based styling API authored in Liquid.

Adopting that framework wholesale conflicts with this project's posture:

- The framework's hard "no custom styles" rule conflicts directly with the BVG Plugin's
  ~700-line custom CSS — that CSS exists because the BVG layout is domain-specific and unlikely
  to be generalisable across Plugins.
- The framework targets four device sizes with `view` adapters; this **Server** targets exactly
  one **Device** (ADR-0001) at native 1872×1404.
- The framework's templating is Liquid; this project's Plugins author JSX (ADR-0002).
- The framework includes runtime JS engines (`data-fit-value`, overflow handlers with `data-*`
  hints, table/item clamping) that introduce a rasterize-time dependency. Currently
  undesirable, but not ruled out — the overflow-handling patches in particular are worth
  revisiting once a concrete Plugin runs into the layout edge cases they solve.
- The framework's colour system covers TRMNL devices with richer palettes; TRMNL X is 4-bit
  gray.

The framework's _research_ — typography scale, gray naming, the Item pattern (`meta + content +
icon`), e-ink physics rules, the 3-second-rule planning exercise — is directly applicable even
when the framework's _delivery_ is not.

Independently, there is a cornerstone constraint on how styles, assets, and JS reach the
Plugin's rendered HTML: **the Plugin author imports every byte that ends up in the HTML**.
Server, Renderer, and PluginManager never inject behind the scenes. This rules out any
"framework auto-loads its own assets" shape.

## Decision

Build a **DesignSystem** at `templates/ds/`. TS-native JSX components + plain CSS,
framework-_informed_ but not framework-_adopted_. Every component is its own import; styles
ship via a `<Styles />` component the Plugin author renders explicitly in `<head>`.

### Surface

The list below is a proposal, not a fixed contract. Components, props, and divisions evolve as
the DesignSystem gets used — the second Plugin will surface ergonomic gaps the first one
didn't.

A **page wrapper** is also under consideration: a component that bundles the default
`<html>/<head>/<body>` boilerplate (including `<Styles />`, charset, title) so Plugin authors
return only their page contents instead of composing the full document each time. Exact API —
name, props, optional vs. required — falls out from the second Plugin's pain points. Plugin
authors can always assemble the boilerplate by hand (as `templates/example/root.tsx` does
today).

- `<Layout>` — flex column container. Default has padding/gap matching BVG's current body
  (`4rem 4.8rem / 2.8rem`). `<Layout bleed>` strips padding for edge-to-edge content (photos,
  full-canvas visualisations).
- `<Content>` — `flex: 1; overflow: hidden`; main content area between chrome elements.
- `<Grid>`, `<Flex>`, `<Columns>` — layout primitives.
- `<Title size>`, `<Value size>`, `<Label>`, `<Description>` — typography. Size variants follow
  the framework's scale (`xxsmall…peta`) as props, not utility classes.
- `<Item meta content icon emphasis>` — the framework's Item pattern; slots are props, not
  compound components.
- `<StatusBar position>` — positioned chrome slot (overlays at top or bottom; works on padded
  or bleed Layouts).
- `<BatteryIndicator value>` — presentation-only battery glyph. Plugin passes the value from
  `ctx.device` (or wherever the telemetry lives in `RunContext`).
- `<EmptyState big sub>` — centred "big number + subtext" pattern for unreachable / no-data
  states.
- `<Styles />` — inlines the DesignSystem's CSS into `<head>`. Author imports and renders once.

### Customization API

Same caveat as Surface — these calls are starting points, not finalised. The
variants-vs-classes and slots-vs-compound choices in particular want real Plugin code to
validate; if they don't survive contact with the second Plugin, the API shifts.

- **Variants** are props, not class strings: `<Title size="lg">`, not `<Title class="title--lg">`.
- **Slots** are props, not compound components: `<Item meta={...} content={...} />`, not
  `<Item><Item.Meta>…</Item.Meta></Item>`.
- **Plugin-specific overrides** ride the existing `<link rel="stylesheet" href="/assets/style.css">`
  pattern that BVG uses today. DesignSystem components emit stable `ds-*` classnames; the
  Plugin's own stylesheet loads after `<Styles />` and wins by source order via standard
  cascade. No `!important`, no hashed-class workarounds.

### What lifts from the TRMNL framework

- Typography scale (`xxsmall…peta`) and the 14-step gray naming (`gray-10…gray-75`).
- The Item pattern (`meta + content + icon`).
- E-ink physics rules: no shadows, gradients, or opacity; `image-dither` on photos only.
- The 3-second rule (the Device gets a ~3-second glance; the **what** — primary metric — the
  context — what it means — and the source must all be instantly legible) and the spatial
  planning exercise that precedes it (decide content blocks, space allocation, primary axis,
  and what gets cut — before writing any markup).

### What stays out (for now)

Deferred rather than permanently rejected. Each can be reconsidered when a concrete Plugin
shows clear need.

- Class-based API.
- "No custom CSS" hard rule.
- Multi-size view adaptation (`view-fullpage`, `view-quadrant`, etc.).
- Liquid coupling.
- Runtime JS engines (`data-fit-value`, etc.) — see the overflow-handling caveat in Context.
- Colour system beyond 4-bit gray.

### Coordinate system

Native **1872×1404**. No global CSS transform. The framework's 1040×780 author-canvas +
`transform: scale(1.8)` trick is rejected because it lossily upscales raster images (photos) at
composite time — the bleed mode would compound that. Plugins that genuinely want a smaller
authoring canvas can apply their own `transform: scale()` in plugin-specific CSS.

### CSS delivery

Plain CSS files under `templates/ds/` — starting with `base.css` — imported as text via Deno's
`with { type: "text" }` attribute import. The `<Styles />` component emits a single `<style>{cssText}</style>` into
`<head>`. `hono/css` (CSS-in-JS via Hono v4's `css` template tag) was considered and deferred:
for a handful of primitives on a single Device, tree-shaking and hashed-class
collision-avoidance are noise; plain CSS is the more readable shape, and plugin overrides stay
trivial because classnames are stable. This is the starting choice, not a permanent one — if
the surface grows past where source-of-truth ambiguity bites, or override patterns get gnarly,
`hono/css` (or another CSS-in-JS shape) is the natural follow-up.

## Consequences

- Plugin authoring becomes JSX + props for typography and layout; plugin-specific CSS lives in
  `pluginDir/assets/style.css` and overrides DesignSystem classes by source order.
- BVG migration: of the current 708 lines in `templates/example/assets/style.css`, roughly 150
  move into the DesignSystem (box reset, rem anchor, body base, Layout padding, StatusBar,
  BatteryIndicator, EmptyState). The remaining ~550 lines — `.head`, `.line-tag`, `.badge*`,
  `.west-list*`, `.h-flow`, `.h-card*`, `.full-grid`, `.hero*`, `.list`, `.row*`,
  `.cancel-strip*`, `.footnote*`, `.leg-*`, `.platform`, `.slot` — stay BVG-specific.
- Fonts (`@font-face` for Inter + Noto Sans Georgian) stay plugin-controlled. DesignSystem
  falls back to `system-ui, sans-serif`.
- The cornerstone holds: every byte in the Plugin's rendered HTML arrives via explicit Plugin
  import. No Server / Renderer / PluginManager injection.
- If TRMNL ships a TS-native framework later, the lifted research stays relevant either way;
  this call doesn't lock the project out of adopting it.
- DesignSystem expansion happens against concrete Plugin pressure, not speculative
  completeness. New components land when the second Plugin needs them.
