# 0002 — Plugin contract: `run(ctx) → Result`

**Status:** Accepted

## Context

We need a **Plugin** contract that:

- Makes "what would the Plugin show for this context?" a well-defined question. The context's `t`
  may be wall-clock now (a Device poll), arbitrary (a dashboard scrub), or near-future (a Conductor
  prerender warm-up). One question, three callers.
- Exposes structured public data so a Super-**Plugin** can compose other Plugins as plain code —
  inspect their Results for routing decisions, weave their views into its own.
- Supports cleaner caching than "hash the rendered HTML" alone (which has false-different failures
  on whitespace and false-same failures on mutable external assets).
- Doesn't bake in single-Device assumptions, lifecycle ceremony, or Server-injected dependencies
  that constrain Plugin author choice.
- Stays as small as possible: one function-of-context that does the Plugin's job.

A previous shape split this surface into `snapshot(t) → Sample` (data) and `present(sample) →
Presentation` (rendering spec). That separation was always called as a pair, did not pay for itself
on the leaf-Plugin side (99% of `present` returned a static view), and made Super-Plugin
composition heavier than it needed to be. The current decision collapses the two into one method.

## Decision

The Plugin's architectural surface is a single method:

```ts
type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender" /* extensible, non-breaking */;
  device: DeviceReport | null; // null before any Device has polled; non-null otherwise
  // open-shape: more fields may be added non-breakingly over time
};

type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Hints;
  // Declared as a method (not an arrow property) so the type is bivariant
  // in S — the orchestrator can type its receive-side as `Result<unknown>`
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
   config the Super-Plugin needs factory-scope sub-Plugin references and a static `view` that
   closes over them — significantly more boilerplate for the routing case.

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

A Plugin module **default-exports a factory** returning the Plugin object. The factory receives the
Server's single loaded config:

```ts
export default function (config: unknown): Plugin<MyState> {
  // use whatever you need from config; factory closure holds internal state
  return { run };
}
```

The Server loads one config blob at boot (from env vars and/or a file — Server-side implementation
detail) and passes it to the factory once. The config is typed `unknown` at the contract boundary;
the Plugin asserts whatever shape it expects. Plugins that don't need config ignore the argument.

**Importing a Plugin module is side-effect-free** — only the factory call activates anything. The
config blob is the only thing the Server hands the Plugin; there is no `services` object of
helpers, no device-state accessors, no render primitives (see ADR-0006).

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
run: (ctx) => sub.run(ctx);

// 2. Routing — pick a sub based on ctx (or sub data), delegate.
run: async (ctx) => {
  const sub = ctx.t.hour >= 7 && ctx.t.hour < 9 ? bvg : photo;
  return await sub.run(ctx);
};

// 3. Wrapping — sub's data and sub's view, but wrap the rendered output in an outer shell.
run: async (ctx) => {
  const inner = await chosen.run(ctx);
  return {
    state: inner.state,
    validity: inner.validity,
    hints: inner.hints,
    view: (s) => <Frame><inner.view {...s} /></Frame>,
  };
};
```

The Server (and Conductor) see exactly one Plugin (the Super-Plugin) and are unaware of nesting.
Composition is plain function composition; no Server-side machinery participates.

Authors who anticipate being composed can split their module (`data.ts` for pure data accessors,
`render.tsx` for view components) so a Super-Plugin can use either half independently. This is a
convention; the contract only requires `run`.

## Consequences

- **One-function Plugin contract.** Simpler to teach, simpler to compose, fewer pairing rules.
- **The dashboard can scrub time coherently.** Conductor calls `run({ t, intent: "scrub", … })`;
  the Plugin computes its Result for that `t` without contaminating Current state.
- **The Conductor can prerender warm-ups** (ADR-0007) by calling
  `run({ t: near-future-t, intent: "prerender", … })` ahead of the next Device poll.
- **View purity is the precondition for the Conductor's caching** (ADR-0004). The contract does
  not enforce it; impure views still produce correct output, they just defeat the Image cache and
  force the expensive rasterize step every call. `docs/plugin-authoring.md` walks authors through
  the traps.
- **Multi-mode displays are a Plugin authoring concern.** Composition uses the same one-function
  interface at every nesting level.
- **Plugin authors define a top-level view component.** A function from state to JSX, named and
  module-scoped — slightly more discipline than "return JSX inline from a render method," and the
  right discipline for downstream reusability.
- **Migration is breaking.** No backwards compatibility with `template` / `setup` / `onDisplay`,
  nor with the interim `snapshot` / `present` shape. The single-user posture (ADR-0001) makes this
  acceptable.
