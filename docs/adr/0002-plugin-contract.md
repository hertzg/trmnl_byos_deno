# 0002 — Plugin contract: `snapshot(t)` + `present(sample)`

**Status:** Accepted

## Context

We need a **Plugin** contract that:

- Makes "what would the Plugin show at time `t`?" a well-defined question (so the dashboard can
  scrub time, not just preview "now").
- Exposes structured public state for composition (so a Super-**Plugin** can route on data, not just
  delegate rendering).
- Supports cleaner caching than "hash the rendered HTML" (which has false-different failures on
  whitespace and false-same failures on mutable external assets).
- Doesn't bake in single-Device assumptions, lifecycle ceremony, or Server-injected dependencies
  that constrain Plugin author choice.
- Separates the Plugin's two natural concerns: **what is true** (data side) and **how should that be
  represented as an image** (rendering specification side).

## Decision

The Plugin's architectural surface is two methods that are always called as a pair:

```ts
type Sample<S> = { state: S; validity: Temporal.Duration };
type Presentation<S> = {
  view: (state: S) => JSX.Element;
  // future hint fields: dither?, viewport?, filters?, ...
};

type Plugin<S> = {
  snapshot(t: Temporal.ZonedDateTime): Sample<S> | Promise<Sample<S>>;
  present(sample: Sample<S>): Presentation<S>;
};
```

- `snapshot(t)` is the **data side**. Returns a **Sample** — the Plugin's public state at moment
  `t`, plus the duration that state stands for. Commitment: the Sample returned for `t` is the right
  answer for `[t, t + validity)`.
- `present(sample)` is the **rendering-spec side**. Returns a **Presentation** — the view component
  the Renderer should invoke with `sample.state`, plus any rasterization hints. The Server always
  calls `present` immediately after `snapshot`; the two are paired.

The Server invokes the resulting Presentation by constructing
`<presentation.view {...sample.state} />`, rendering it to HTML, and feeding that into the render
pipeline (ADR-0003).

### Module shape

A Plugin module **default-exports a factory** returning the Plugin object. The factory receives the
Server's single loaded config:

```ts
export default function (config: unknown): Plugin<MyState> {
  // use whatever you need from config; factory closure holds internal state
  return { snapshot, present };
}
```

The Server loads one config blob at boot (from env vars and/or a file — Server-side implementation
detail) and passes it to the factory once. The config is typed `unknown` at the contract boundary;
the Plugin asserts whatever shape it expects. Plugins that don't need config ignore the argument.

**Importing a Plugin module is side-effect-free** — only the factory call activates anything. The
config blob is the only thing the Server hands the Plugin; there is no `services` object of helpers,
no device-state accessors, no render primitives (see ADR-0006).

### Value objects on the boundary

- `t: Temporal.ZonedDateTime` — zone-aware. The Server is configured with the Device's zone and
  passes it through.
- `validity: Temporal.Duration` — unit-explicit; arithmetic-safe (`t.add(validity)`).

`Date` is not used at the contract boundary.

### Composition

A Super-Plugin imports other Plugins and composes them as plain code. Its own `snapshot` calls
sub-Plugin `snapshot`s (inspecting their Samples for routing decisions on data), and its own
`present` invokes sub-Plugin `present`s and weaves the resulting views into its own JSX:

```ts
import createBvg from "./bvg/main.ts";
import createPhoto from "./photo/main.ts";

export default function (config: unknown) {
  const bvg = createBvg(config?.bvg);
  const photo = createPhoto(config?.photo);

  return {
    snapshot(t) {
      const isCommute = t.hour >= 7 && t.hour < 9;
      if (isCommute) {
        const s = bvg.snapshot(t);
        if (s.state.entries.length) {
          return { state: { mode: "bvg", inner: s.state }, validity: s.validity };
        }
      }
      const s = photo.snapshot(t);
      return { state: { mode: "photo", inner: s.state }, validity: s.validity };
    },
    present(sample) {
      const sub = sample.state.mode === "bvg" ? bvg : photo;
      const subSample = { state: sample.state.inner, validity: sample.validity };
      const subPresentation = sub.present(subSample);
      return {
        view: (state) => <subPresentation.view {...state.inner} />,
      };
    },
  };
}
```

The Server still sees exactly one Plugin (the Super-Plugin) and is unaware of nesting. Composition
is plain function composition; no Server-side machinery participates.

Authors who anticipate being composed can split their module (`data.ts` for pure data accessors,
`render.tsx` for view components) so a Super-Plugin can use either half independently. This is a
convention; the contract only requires the two methods above.

### Why `present` returns a Presentation, not JSX directly

A `present(sample) → JSXElement` shape would conflate "the renderer's job" with "the Plugin's job."
Returning a Presentation cleanly separates them:

- The Plugin says: "here is the view component the renderer should invoke, plus any hints I'd like
  respected."
- The Server / Renderer says: "I'll invoke your view with the sample's state, derive HTML, and
  decide what to do based on my own pipeline."

It also leaves the Presentation type extensible: future rasterization hints (dither, viewport,
filters) land as additional optional fields without changing the method shape.

## Consequences

- **Two-surface Plugin: data + presentation.** Both are independently inspectable by composers.
- **The dashboard can scrub time coherently.** `snapshot(t) + present(sample)` is well-defined for
  any `t`.
- **`view` purity is the precondition for the Server's caching** (ADR-0004). The contract does not
  enforce it; impure views still produce correct output, they just defeat the Image cache and force
  the expensive raster step every call. `docs/plugin-authoring.md` walks authors through the traps.
- **Multi-mode displays are a Plugin authoring concern.** Composition uses the same interface at
  every nesting level.
- **Plugin authors must define a top-level view component.** A function from state to JSX, named and
  module-scoped — slightly more discipline than "return JSX inline from a render method," and the
  right discipline for downstream reusability.
- **Migration is breaking.** No backwards compatibility with `template` / `setup` / `onDisplay`. The
  single-user posture (ADR-0001) makes this acceptable.
