# Writing a Plugin

This is a practical guide for writing a **Plugin** that works well with the **Server** and its
**Conductor**. It assumes you've read [CONTEXT.md](../CONTEXT.md) (vocabulary) and skimmed
[ADR-0002](adr/0002-plugin-contract.md) (the contract). The contract is the law; this guide is
opinion and pattern.

## The shape

A Plugin module **default-exports a factory** that returns an object with one method. The factory
receives the Server's single config blob:

```ts
import { Temporal } from "node:temporal"; // or whatever Deno exposes today

type RunContext = {
  t: Temporal.ZonedDateTime;
  intent: "poll" | "scrub" | "prerender";
  device: DeviceReport;
  // open-shape: more fields may be added non-breakingly
};

type Result<S> = {
  state: S;
  validity: Temporal.Duration;
  hints?: Hints;
  view: (state: S) => JSX.Element;
};

type Plugin<S> = {
  run(ctx: RunContext): Result<S> | Promise<Result<S>>;
};

export default function (config: unknown): Plugin<MyState> {
  /* ... */
}
```

That's it. The Server calls your factory once at boot with the loaded config. The Conductor calls
`run(ctx)` on each trigger — Device poll, dashboard scrub, or prerender warm-up. Importing your
module never activates anything — only the factory call does.

The config is typed `unknown` at the boundary because the Server has no opinion on what's in it.
Assert whatever shape you need inside the factory. If you don't need config, ignore the argument:

```ts
// uses config:
export default function (config: unknown) {
  const cfg = config as { apiKey: string; refreshSeconds?: number };
  // ...
}

// doesn't use config:
export default function () {
  // ...
}
```

## The factory pattern (and why no module globals)

Your Plugin almost certainly needs _some_ internal state — a cached fetch result, a timer, a derived
index. Put it in the **factory closure**, not at module scope:

```tsx
// good
function MyView(state: State) {
  return <Card data={state.data} />;
}

export default function () {
  let data: Data | null = null;
  const refresh = async () => {
    data = await fetchData();
  };
  refresh();
  setInterval(refresh, 60_000);

  return {
    run({ t }) {
      return {
        state: /* derive from data + t */,
        validity: /* … */,
        view: MyView,
      };
    },
  };
}
```

```tsx
// bad — module-level state
let data: Data | null = null;
const refresh = async () => {
  data = await fetchData();
};
refresh();
setInterval(refresh, 60_000);

export default function () {
  return {
    run({ t }) {/* read `data` */},
  };
}
```

Both work today. The factory version is better because:

1. **Import is side-effect-free.** A test file that does `import factory from "./my-plugin.ts"`
   doesn't trigger fetches or timers. It can construct the Plugin (or not) as it sees fit.
2. **Each call to the factory is independent.** Tests can instantiate multiple isolated copies.
   Hot-reload (if it ever exists) discards old instances cleanly.
3. **Module-globals make composition unsafe.** A Super-Plugin that imports two instances of the same
   Plugin from different paths would still share module state — silently, with no error.

If you'd rather write a class than a factory, that's fine — `export default () => new MyPlugin()`
makes them equivalent.

## Two ways to think about `run`

Different Plugins fit different framings. Both produce the same contract; the framing just changes
how you organize your head.

### Data-driven (BVG, weather, calendar)

You have a world-knowledge layer (fetched data, refreshed on its own cadence). `run({ t, … })` is
"given what I currently know about the world, what's the Result at `t`?"

```tsx
type BvgState = { entries: Departure[]; t: Temporal.ZonedDateTime };

function BvgBoard(state: BvgState) {
  return <Board {...state} />;
}

export default function () {
  let board: Board | null = null;
  setInterval(async () => {
    board = await fetchBoard();
  }, 60_000);
  fetchBoard().then((b) => {
    board = b;
  });

  return {
    run({ t }) {
      const relevant =
        board?.entries.filter((e) => Temporal.ZonedDateTime.compare(e.departure, t) >= 0).slice(
          0,
          5,
        ) ?? [];
      const validity = computeValidity(relevant, t);
      return {
        state: { entries: relevant, t },
        validity,
        view: BvgBoard,
      };
    },
  };
}
```

### Time-indexed (photo rotation, clock, calendar)

There's no external data layer — the answer is determined entirely by `t`. `run({ t, … })` is "what
would I show at moment `t`?"

```tsx
const photos = ["a.jpg", "b.jpg", "c.jpg"];
const rotateMs = 6 * 60 * 60 * 1000; // 6h

type PhotoState = { photo: string };
function PhotoView(state: PhotoState) {
  return <img src={state.photo} />;
}

export default function () {
  return {
    run({ t }) {
      const idx = Math.floor(t.epochMilliseconds / rotateMs) % photos.length;
      const nextRotation = (Math.floor(t.epochMilliseconds / rotateMs) + 1) * rotateMs;
      const validity = Temporal.Duration.from({
        milliseconds: nextRotation - t.epochMilliseconds,
      });
      return {
        state: { photo: photos[idx] },
        validity,
        view: PhotoView,
      };
    },
  };
}
```

Same contract, different mental shape. If your Plugin is mostly data-driven with a sprinkle of time
logic, you're in the first camp. If it's mostly time logic with no external data, the second.

## The two-layer structure of a real Plugin

A data-driven Plugin always has two layers:

1. **World-knowledge layer** — fetches, caches, subscribes. Lives in the factory closure. Updates on
   wall-clock cadence (timers).
2. **Render layer** — `run({ t, … })` reads from the world-knowledge layer, derives state, decides
   validity, and returns a Result with the view component included. The view itself is a pure
   function of `state`.

Keep them separate even within your own Plugin:

```tsx
function BvgBoard(state: BvgState) {
  return <Board entries={state.entries} renderedAt={state.t} />;
}

export default function () {
  // ─── layer 1: world-knowledge ─────────────────────────
  let board: Board | null = null;
  const refresh = async () => {
    board = await fetchBoard();
  };
  refresh();
  setInterval(refresh, 60_000);

  // ─── layer 2: run (no fetches here) ───────────────────
  return {
    run({ t }) {
      const relevant = board?.entries.filter(/* ... */) ?? [];
      return {
        state: { entries: relevant, t },
        validity: /* … */,
        view: BvgBoard,
      };
    },
  };
}
```

`run` reads from the world-knowledge layer; it doesn't fetch. The view itself is a function of
`state` only; it doesn't fetch, doesn't read timers, doesn't call `new Date()`.

## Honor `t`. Always.

`run({ t, … })` is asked about a specific moment. That moment might be wall-clock now (a Device
poll), 47 minutes in the future (a dashboard scrub), or a few seconds ahead of the next poll (a
prerender warm-up). Your Plugin doesn't know which — and shouldn't need to in the common case.

```ts
// good — uses t
run({ t }) {
  const isCommute = t.hour >= 7 && t.hour < 9;
  return { state: { isCommute }, validity: /* … */, view: MyView };
}

// bad — uses wall-clock; looks right at t=now, wrong everywhere else
run({ t }) {
  const now = Temporal.Now.zonedDateTimeISO("Europe/Berlin");
  const isCommute = now.hour >= 7 && now.hour < 9;
  return { state: { isCommute }, validity: /* … */, view: MyView };
}
```

The bad version "works" when the Device polls (because t ≈ now) and breaks visibly the first time
you scrub forward in the dashboard — every scrub frame looks like "now." The dashboard's scrub is
your test for this trap.

The same rule applies to validity:

```ts
// good
validity: Temporal.Duration.from({ minutes: minutesUntilNextRelevantBoundary(t) });

// bad
const minutesLeft = Math.floor((Date.now() - someInternalDeadline.getTime()) / 60_000);
validity: Temporal.Duration.from({ minutes: minutesLeft });
```

Compute everything against `t`. Wall-clock is fine for the _internal_ world-knowledge layer (refresh
timers, fetch decisions) — those are about the real world. But anything that goes into the Result's
`state` or `validity` should be a function of `t`.

## When `intent` actually matters

Most Plugins behave identically for `poll`, `scrub`, and `prerender`. Read `ctx.intent` only when
the Plugin is _state-advancing_ — i.e. running it changes what the next call will return.

```tsx
// a "next photo on every poll" Plugin
let cursor = 0;

run({ t, intent }) {
  // Only advance on a real Device poll. A prerender will be paired with the matching poll
  // and we don't want to advance twice; a scrub is a read-only inspection.
  if (intent === "poll") cursor = (cursor + 1) % photos.length;
  return {
    state: { photo: photos[cursor] },
    validity: Temporal.Duration.from({ hours: 1 }),
    view: PhotoView,
  };
}
```

If your Plugin is stateless across calls (BVG, weather, clock), `intent` is irrelevant — your `run`
already gives the same answer for the same `t`.

## View purity: not enforced, strongly recommended

The Conductor returns `filename = image-${identityFor(html)}` on `/api/display`. The Device's
firmware compares it against the previous poll's filename and skips both the image download and the
e-ink refresh when it matches (see ADR-0004). The server itself doesn't cache rendered PNGs — every
Device fetch live-renders — so this Device-side filename comparison is the _only_ cache that fires.
If your `view` is a pure function of `state`, identical state → identical JSX → identical HTML →
identical filename → Device skips the repaint. If your view isn't pure (reads `Date.now()`,
closures, random), the HTML differs across calls → different filename → Device repaints on every
poll. The output is still **correct**; you just defeat the flicker-avoidance mechanism.

Pure view means:

- No `new Date()` inside `view`.
- No reading from closures that change between calls (use `state` for everything view-relevant).
- No randomness, no incrementing counters.
- No side effects.

If you need _something_ time-relevant in your visuals, put it in `state` (which `run` puts there
based on `t`). Then `view(state)` stays pure.

## Common traps

| Trap                              | What it looks like                                                                                                      | How to spot it                                                                                      | How to fix                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Wall-clock in view                | Preview shows current time even when you scrub forward.                                                                 | Scrub `+1h`; preview should change appropriately. If it shows "now," you're reading the wall-clock. | Put time-relevant data in `state` via `run({ t })`; read from `state` in `view`. |
| Wall-clock in validity            | Timeline ticks in the dashboard don't move when you scrub.                                                              | Scrub forward; the boundaries on the timeline strip should slide with `t`.                          | Compute validity against `ctx.t`, not against wall-clock.                        |
| Module globals                    | Two tests interfere; restart fixes things mysteriously.                                                                 | Run a test twice in the same process.                                                               | Move state into the factory closure.                                             |
| Fetches inside `run`              | Dashboard scrub is slow; lots of network noise.                                                                         | Open Network tab in the browser; scrub the dashboard.                                               | Move fetches to the world-knowledge layer (factory body + timer).                |
| State-advancing on every intent   | Scrubbing the dashboard advances state that should only advance on real polls.                                          | Scrub forward and back; state-advancing Plugins drift unexpectedly.                                 | Gate state advance on `ctx.intent === "poll"`.                                   |
| Mutating state after returning it | Rendered output doesn't match the state shown in debug tools.                                                           | Inspect `state` in the dashboard's data view (when implemented).                                    | Return immutable / freshly-constructed `state` objects.                          |
| External-mutable assets           | `<img src="https://cdn/x.jpg">` whose bytes change without the URL changing — Device skips a repaint when it shouldn't. | A change is "missed" — the Device still shows the previous picture.                                 | Inline mutable image bytes as data URIs, so the change is in the state.          |

## A worked example

A small data-driven Plugin that shows the next BVG departures, refreshing every minute, becoming
"idle" outside commute hours:

```tsx
import { Temporal } from "node:temporal";
import { type Board, fetchBvgBoard } from "./bvg/data.ts";
import { BoardView, IdleView } from "./bvg/render.tsx";

type State =
  | { kind: "board"; entries: Board["entries"]; renderedAt: Temporal.ZonedDateTime }
  | { kind: "idle"; reason: string };

function BvgPluginView(state: State) {
  return state.kind === "board"
    ? <BoardView entries={state.entries} renderedAt={state.renderedAt} />
    : <IdleView reason={state.reason} />;
}

export default function () {
  // world-knowledge layer
  let board: Board | null = null;
  const refresh = async () => {
    try {
      board = await fetchBvgBoard();
    } catch {}
  };
  refresh();
  setInterval(refresh, 60_000);

  return {
    run({ t }): Result<State> {
      const isCommute = t.hour >= 7 && t.hour < 9;
      if (!isCommute) {
        const nextStart = nextCommuteStart(t);
        return {
          state: { kind: "idle", reason: "outside commute hours" },
          validity: t.until(nextStart, { largestUnit: "minutes" }),
          view: BvgPluginView,
        };
      }

      const upcoming = (board?.entries ?? []).filter((e) =>
        Temporal.ZonedDateTime.compare(e.departure, t) >= 0
      ).slice(0, 5);

      const nextBoundary = upcoming[0]?.departure ?? nextCommuteEnd(t);
      return {
        state: { kind: "board", entries: upcoming, renderedAt: t },
        validity: t.until(nextBoundary, { largestUnit: "minutes" }),
        view: BvgPluginView,
      };
    },
  };
}

function nextCommuteStart(t: Temporal.ZonedDateTime) {/* ... */}
function nextCommuteEnd(t: Temporal.ZonedDateTime) {/* ... */}
```

Notes:

- World-knowledge layer (the `board` cache + refresh timer) is in the factory body, _not_ at module
  scope.
- `run` doesn't fetch — it reads from the closure-cached `board`.
- All time-relevant decisions (`isCommute`, `nextBoundary`, `upcoming`) come from `t`, not from
  wall-clock.
- `view` (BvgPluginView) is pure on `state` — given the same state, it returns the same JSX, and
  branches on `state.kind` to pick the variant.
- `validity` is computed from `t`, not from wall-clock.
- `intent` is not read because this Plugin is stateless across calls.

## Composition: writing a Super-Plugin

A Super-Plugin imports other Plugins and composes them. It's just a Plugin — same `{ run }` shape —
that calls sub-Plugin factories, runs them, and assembles their Results:

```tsx
import createBvg from "./bvg/main.ts";
import createPhoto from "./photo/main.ts";

type MainState =
  | { mode: "bvg"; inner: BvgState }
  | { mode: "photo"; inner: PhotoState };

export default function (config: unknown) {
  const bvg = createBvg(config?.bvg);
  const photo = createPhoto(config?.photo);

  return {
    async run(ctx): Promise<Result<MainState>> {
      if (ctx.t.hour >= 7 && ctx.t.hour < 9) {
        const bvgResult = await bvg.run(ctx);
        if (bvgResult.state.entries.length) {
          return {
            state: { mode: "bvg", inner: bvgResult.state },
            validity: bvgResult.validity,
            hints: bvgResult.hints,
            view: (s) => <bvgResult.view {...(s as { mode: "bvg"; inner: BvgState }).inner} />,
          };
        }
      }
      const photoResult = await photo.run(ctx);
      return {
        state: { mode: "photo", inner: photoResult.state },
        validity: photoResult.validity,
        hints: photoResult.hints,
        view: (s) => <photoResult.view {...(s as { mode: "photo"; inner: PhotoState }).inner} />,
      };
    },
  };
}
```

The Super-Plugin can route on sub-Plugin data (`bvgResult.state.entries.length` before committing to
BVG) and delegate to sub-Plugin views (the `view` references each Result's `view` directly). No
Server-side composition machinery; it's just imports and function composition.

For the _pure pass-through_ case (no routing, no wrapping), the Super-Plugin is a one-liner:

```ts
run: ((ctx) => sub.run(ctx));
```

## Module layout for downstream composability

If you write a Plugin you might want a Super-Plugin to compose later (yours or someone else's),
split your module so the data layer and view layer can be imported independently:

```
widgets/bvg/
  ├── main.ts       ← default-exports the Plugin factory (uses data + render internally)
  ├── data.ts       ← fetchBvgBoard(), isCommuteWindow(t), nextRelevant(t), Board type
  └── render.tsx    ← <BoardView/>, <IdleView/> — pure rendering of those types
```

A Super-Plugin can then `import { fetchBvgBoard } from "./bvg/data.ts"` to inspect BVG's data layer
without going through the full Plugin contract, or `import { BoardView } from "./bvg/render.tsx"` to
embed BVG's render output into a custom layout.

This convention is documented but not enforced — you only need it if you (or downstream authors)
want to compose your Plugin into something larger. A leaf Plugin doesn't need the split.

## What you don't need to worry about

The Conductor + Renderer handle everything past `run(ctx) → Result`. You do not implement:

- HTML derivation (`deriveHtml` invokes your view with the Result's state and runs
  `renderToString`).
- Rasterization (`fetchPngFromUrl` screenshots `/preview` via CDP and dithers the result).
- Image identity / filename derivation.
- HTTP routes, BYOS protocol, refresh rates.

You return a Result. The rest is the Server's problem.

## When to ignore this guide

This document is opinion. The contract is the law (ADR-0002). If a pattern here doesn't fit your
Plugin and you have a clearer way to honor the contract, do that. The factory-vs-class choice, the
data.ts/render.tsx split, the "pure view" recommendation — all of these are guidance for the common
case, not requirements.

The two things that aren't negotiable:

1. **The Result for `ctx.t` is the right answer for `[ctx.t, ctx.t + validity)`.** Don't return
   state that's already wrong for the validity you declared.
2. **The `view` inside the Result must accept the Result's state shape.** The type system enforces
   this; don't fight it with `as any` casts.

Everything else is style.
