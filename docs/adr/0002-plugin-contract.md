# 0002 — Plugin contract: `run(ctx) → Result`, assets via folder convention

**Status:** Accepted

## Context

We need a **Plugin** contract that:

- Makes "what would the Plugin show for this context?" a well-defined question. The context's `t`
  may be wall-clock now (a Device poll) or arbitrary (a dashboard scrub). One question, two callers.
- Exposes structured public data so a Super-**Plugin** can compose other Plugins as plain code —
  inspect their Results for routing decisions, weave their views into its own.
- Lets identity be computed deterministically from a Plugin's output, so the Slot (ADR-0004) can hit
  on stable content and the Device's filename cache can skip repaints.
- Doesn't bake in single-Device assumptions, lifecycle ceremony, or Server-injected helpers that
  constrain Plugin author choice.
- Stays as small as possible: one function-of-context that does the Plugin's job, plus a folder for
  assets.

A previous shape split this surface into `snapshot(t) → Sample` (data) and
`present(sample) →
Presentation` (rendering spec). That separation was always called as a pair, did
not pay for itself on the leaf-Plugin side (99% of `present` returned a static view), and made
Super-Plugin composition heavier than it needed to be. The current decision collapses the two into
one method and rides the view on the Result.

## Decision

### Architectural surface

```ts
type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub"; // extensible, non-breaking
  device: DeviceReport | null; // null before any Device has polled; non-null otherwise
  // open-shape: more fields may be added non-breakingly over time
};

type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Hints;
  // Declared as a method (not an arrow property) so the type is bivariant
  // in S — the PluginManager can type its receive-side as `Result<unknown>`
  // without forcing every Plugin's `Result<MyState>` to be a strict
  // subtype. Authors still write arrow-function values
  // (`view: (s) => <Card data={s} />`); method syntax is purely about
  // the type's variance.
  view(state: S): unknown;
};

type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};
```

`run(ctx)` returns a `Result` carrying:

- `state` — the Plugin's public data shape at the requested moment, given the supplied context.
- `validity` — the duration that Result stands for. Commitment: the Result is the right answer for
  `[ctx.t, ctx.t + validity)`.
- `hints` (optional) — rasterization hints the Renderer may consult.
- `view` — the JSX component the Renderer invokes with `state`.

### Why `view` rides in the Result

A briefly-entertained shape had `Plugin = { run, view }` with `view` as static config. Two reasons
to put `view` on the Result instead:

1. View and state are type-locked (`view: (state: S) => JSXElement`). Storing them together is
   structurally honest; storing them apart forces every caller to pair them by convention.
2. It makes Super-Plugin composition mechanical. A delegating Super-Plugin can pass a sub-Plugin's
   full Result through with no wrapper code (`run: (ctx) => sub.run(ctx)`). With `view` as separate
   config the Super-Plugin needs factory-scope sub-Plugin references and a static `view` that closes
   over them — significantly more boilerplate for the routing case.

The cost is one extra line in the typical leaf Plugin's `run` return (`view: MyView`). That's a
small fixed cost for a meaningful composition gain.

### `RunContext` is always passed and open-shaped

`run` always receives a `RunContext` (never just `t`). Plugins that only care about `t` destructure
`({ t })`; everything else they ignore. The bag is documented as open: fields may be added
non-breakingly because every Plugin already receives the full record. Adding a field is
non-breaking; removing one is.

The initial fields are `t`, `intent`, and `device`. `intent` resolves the previously-open question
of whether a Plugin should know it's being asked for a real poll vs. a scrub — yes, via this field.

### Module shape

A Plugin module **default-exports a Plugin object** — `{ run }`. The PluginManager imports the
module and reads the default export as a Plugin; there is no factory invocation.

```ts
export default {
  run(ctx) {
    return {
      state: {/* … */},
      view: (s) => <Card data={s} />,
      validity: Temporal.Duration.from({ seconds: 300 }),
    };
  },
} satisfies Plugin<MyState>;
```

Authors who need closure state (caches, timers, fetched-once data) build the Plugin inline at the
export site:

```ts
export default (() => {
  const cache = new Map<string, Departures>();
  return {
    run(ctx) {
      /* use cache */
    },
  } satisfies Plugin<MyState>;
})();
```

**Importing a Plugin module is side-effect-free** beyond whatever the author chooses to do at module
top-level. The PluginManager hands the Plugin nothing — no config object, no `services` bag of
helpers, no device-state accessors, no render primitives (see ADR-0006). Anything the Plugin needs
comes from `import` and from `RunContext`.

### Asset packaging

A Plugin's static assets (images, fonts, stylesheets) live in `pluginDir/assets/`. PluginManager
reads the directory recursively at load time and attaches the resulting
`Record<urlPath,
Uint8Array>` to every Bundle it produces.

The view references assets by their `/assets/...` URL path:

```tsx
view: ((s) => (
  <div>
    <link rel="stylesheet" href="/assets/style.css" />
    <img src="/assets/icons/bell.svg" />
  </div>
));
```

Renderer's internal HTTP server (ADR-0003) serves these to CDP during screenshot. There is no public
`/assets/*` route on the Server's outward HTTP surface; the only place the bytes are served from is
inside the Renderer's own loopback origin.

Adding an asset is "drop a file"; renaming an asset means updating the path string in the view.
Assets contribute to the Bundle's identity (ADR-0004), so an asset change invalidates the Device's
filename cache on the next poll.

### Value objects on the boundary

- `RunContext.t: Temporal.ZonedDateTime` — zone-aware. The Server is configured with the Device's
  zone and passes it through.
- `Result.validity: Temporal.Duration` — unit-explicit; arithmetic-safe
  (`ctx.t.add(result.validity)`).

`Date` is not used at the contract boundary.

### Composition

A Super-Plugin imports other Plugins and composes them as plain code. Its `run(ctx)` calls
sub-Plugin `run`s, inspects their Results for routing decisions, and returns its own Result. Three
common shapes:

```tsx
// 1. Pure pass-through — sub's data + sub's view rides through unchanged.
run: ((ctx) => sub.run(ctx));

// 2. Routing — pick a sub based on ctx (or sub data), delegate.
run: (async (ctx) => {
  const sub = ctx.t.hour >= 7 && ctx.t.hour < 9 ? bvg : photo;
  return await sub.run(ctx);
});

// 3. Wrapping — sub's data and sub's view, but wrap the rendered output in an outer shell.
run: (async (ctx) => {
  const inner = await chosen.run(ctx);
  return {
    state: inner.state,
    validity: inner.validity,
    hints: inner.hints,
    view: (s) => (
      <Frame>
        <inner.view {...s} />
      </Frame>
    ),
  };
});
```

The Server (and Conductor) see exactly one Plugin (the Super-Plugin) and are unaware of nesting.
Composition is plain function composition; no Server-side machinery participates.

How a Super-Plugin aggregates its sub-Plugins' `assets/` directories is deferred (CONTEXT.md flags
this open question). Until a concrete Super-Plugin exists, the folder convention applies to the
outermost Plugin only.

## Consequences

- **One-function Plugin contract plus a folder.** Simple to teach, simple to compose, no authoring
  boilerplate per asset.
- **The dashboard can scrub time coherently.** Conductor (or Dashboard directly) calls
  `run({ t, intent: "scrub", … })`; the Plugin computes its Result for that `t` without
  contaminating the Slot.
- **View purity helps but isn't required** (see ADR-0004). The contract does not enforce it; impure
  views still produce correct output, they just defeat the Slot's hit-on-stable-identity and force a
  re-rasterize per poll.
- **Multi-mode displays are a Plugin authoring concern.** Composition uses the same one-function
  interface at every nesting level.
- **Plugin authors define a top-level view component.** A function from state to JSX, named and
  module-scoped — slightly more discipline than "return JSX inline from a render method," and the
  right discipline for downstream reusability.
- **Asset paths are stringly-typed.** A typo in `<img src="/assets/foo.svg" />` won't be caught by
  the compiler; it'll show as a broken image in the screenshot. Single-user posture (ADR-0001)
  accepts this; an `asset()` helper that returns paths from declared bytes was explicitly considered
  and rejected as more machinery than it earned over the folder convention.
- **Migration is breaking.** No backwards compatibility with `template` / `setup` / `onDisplay`, nor
  with the interim `snapshot` / `present` shape, nor with the previous factory-based default export.
  The single-user posture (ADR-0001) makes this acceptable.
