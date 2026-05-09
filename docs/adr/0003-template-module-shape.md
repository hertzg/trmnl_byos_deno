# 0003 — Template module shape: `setup` returning `{ onPoll }`

**Status:** Accepted — 2026-05-09
**Related:** ADR-0002 (render protocol)

## Context

Today's template exports a single `run(ctx)` function that returns a JSX
component plus props. This shape conflates "compute the next frame" with
"hold any state I need across polls." Templates that want module-level state
have to write it as top-level mutable bindings, which is awkward to type and
hard to test.

Given ADR-0002, the template's job is now: return a token on each poll.
That token may be (a) computed inline via `services.render`, or (b) read
from state populated earlier (timer, webhook, boot-time). State management
belongs to the template — but the API should make the simple cases trivial
and the stateful cases obvious.

## Decision

A user template exports a single named function:

```ts
export async function setup(services: Services): Promise<{
  onPoll: (ctx: PollContext) => Promise<{ token: string; refreshAfter: number }>;
}>
```

- The service calls `setup(services)` once at boot and stashes the returned
  registration object.
- `setup`'s closure is the natural place for state: `let cached = ...`,
  timers, subscriptions. `onPoll` reads from that closure.
- `services` is **not** re-injected into `onPoll`; user code captures it
  from the `setup` closure if it needs to call `render` lazily.
- `PollContext` carries device intel: `{ device: { id, panel, headers }, now }`.

A trivial lazy template:

```ts
export async function setup(services: Services) {
  return {
    async onPoll(ctx) {
      const token = await services.render(<Card data={await fetchData()}/>);
      return { token, refreshAfter: 60 };
    },
  };
}
```

A pre-rendering template:

```ts
export async function setup(services: Services) {
  let token = await services.render(<Card data={await fetchData()}/>);
  setInterval(async () => {
    token = await services.render(<Card data={await fetchData()}/>);
  }, 60_000);
  return {
    async onPoll() { return { token, refreshAfter: 60 }; },
  };
}
```

## Consequences

- **No module-scope mutable state required.** The closure is the state
  container. Templates are easier to reason about and to test (call
  `setup` with a mock `services`, drive `onPoll` with synthetic contexts).
- **`setup` is the boot hook.** A template that crashes during `setup`
  crashes the service at boot — fail fast. This matches our intent that
  the template owns its lifecycle: if it can't even initialize, there's
  nothing meaningful to serve.
- **`onPoll` errors at runtime serve an error frame.** Service catches,
  renders an error card to a token, returns that — but the user can pre-empt
  this by catching in their own `onPoll` and returning a known-good token.
- **No more `kind: "preview" | "device"` distinction** at the user-code
  layer. Preview semantics, if reintroduced later, will not pollute the
  poll path. See ADR-0005.
- **Loader change**: `loadTemplate` now imports the module and verifies
  `typeof setup === "function"` instead of `run`.
