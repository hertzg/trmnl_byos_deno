# 0003 — Template module shape: `setup` returning `{ onDisplay }`

**Status:** Revised by ADR-0006 (#13). The `setup`/`onDisplay` shape is preserved in spirit
(template = declarative; closure = state container) but signatures change substantively:

- `setup(services)` → `setup(config: SetupConfig)` — no `Services` argument; `SetupConfig` carries
  the active device profile.
- `onDisplay(ctx) → { token, refreshAfter }` → `onDisplay() → { jsx, validForSeconds }` — no
  per-poll context (frames are shared across the fleet, so per-device branching can't be honoured),
  and templates return the JSX they want rendered rather than a token they obtained from a service
  primitive.

The examples below describe the original shape; the new shape is in ADR-0006.

**Related:** ADR-0002 (superseded), ADR-0006 (successor for the render-side contract)

## Context

Today's template exports a single `run(ctx)` function that returns a JSX component plus props. This
shape conflates "compute the next frame" with "hold any state I need across requests." Templates
that want module-level state have to write it as top-level mutable bindings, which is awkward to
type and hard to test.

Given ADR-0002, the template's job is now: when the runtime asks what to display, return a token.
That token may be (a) computed inline via `services.renderJsx`, or (b) read from state populated
earlier (timer, webhook, boot-time). State management belongs to the template — but the API should
make the simple cases trivial and the stateful cases obvious.

## Decision

A user template exports a single named function:

```ts
export async function setup(services: Services): Promise<{
  onDisplay: (ctx: OnDisplayContext) => Promise<{ token: string; refreshAfter: number }>;
}>;
```

- The service calls `setup(services)` once at boot and stashes the returned registration object.
- `setup`'s closure is the natural place for state: `let cached = ...`, timers, subscriptions.
  `onDisplay` reads from that closure.
- `services` is **not** re-injected into `onDisplay`; user code captures it from the `setup` closure
  if it needs to call `renderJsx` lazily.
- `OnDisplayContext` carries device intel: `{ device: { id, panel, headers }, now }`.

A trivial lazy template:

```ts
export async function setup(services: Services) {
  return {
    async onDisplay(ctx) {
      const token = await services.renderJsx(<Card data={await fetchData()} />);
      return { token, refreshAfter: 60 };
    },
  };
}
```

A pre-rendering template:

```ts
export async function setup(services: Services) {
  let token = await services.renderJsx(<Card data={await fetchData()} />);
  setInterval(async () => {
    token = await services.renderJsx(<Card data={await fetchData()} />);
  }, 60_000);
  return {
    async onDisplay() {
      return { token, refreshAfter: 60 };
    },
  };
}
```

## Consequences

- **No module-scope mutable state required.** The closure is the state container. Templates are
  easier to reason about and to test (call `setup` with a mock `services`, drive `onDisplay` with
  synthetic contexts).
- **`setup` is the boot hook.** A template that crashes during `setup` crashes the service at boot —
  fail fast. This matches our intent that the template owns its lifecycle: if it can't even
  initialize, there's nothing meaningful to serve.
- **`onDisplay` errors at runtime serve an error frame.** Service catches, renders an error card to
  a token, returns that — but the user can pre-empt this by catching in their own `onDisplay` and
  returning a known-good token.
- **No more `kind: "preview" | "device"` distinction** at the user-code layer. Preview semantics, if
  reintroduced later, will not pollute the display path. See ADR-0005.
- **Loader change**: `loadTemplate` now imports the module and verifies
  `typeof setup === "function"` instead of `run`.
