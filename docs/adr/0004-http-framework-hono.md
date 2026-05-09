# 0004 — HTTP framework: Hono

**Status:** Accepted — 2026-05-09

## Context

The service currently runs on Oak (`@oak/oak`). Hono is already a project dependency — it provides
the JSX runtime via `hono/jsx` for template rendering. We have two HTTP-shaped libraries pulled in
for what is in practice one role.

Oak's API is fine but verbose for our routes; the routing surface is small (four BYOS endpoints, an
image endpoint, a static asset path, an internal seam). The Oak `Context` and Router types add
ceremony — `ctx.response.body`, `ctx.response.headers.set`, `ctx.params`, etc. Hono is more compact
and matches the JSX runtime we're already shipping.

## Decision

Migrate the HTTP layer from Oak to Hono. Drop `@oak/oak` from `deno.jsonc` imports. Add `hono`
runtime (the same JSR package `@hono/hono` we already use for JSX).

Routes use Hono's compact handlers:

```ts
const app = new Hono();
app.get("/api/display", (c) => c.json({ ... }));
```

Static assets continue to be served from the template's `assets/` directory when present.

## Consequences

- One framework instead of two, smaller bundle, less surface area to learn for contributors.
- Trivial migration: routes are short and stateless. The `try/catch`-style request log middleware
  ports to Hono's `app.use`.
- Hono's `c.req.raw.headers` is the equivalent of Oak's `ctx.request.headers` — no behavioral
  change.
- We lose Oak's built-in `send` for static files; Hono has `serveStatic` for Deno or we can write a
  tiny `Deno.readFile`-based handler. Either is fine for the single-prefix `/assets/*` we serve.
- This is a behavior-preserving change at the protocol level — the device contract is unaffected.
