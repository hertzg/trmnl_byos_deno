# Vision

## What this is

A personal, opinionated back end for a single TRMNL e-ink **Device**, written by and for one
engineer who is comfortable in code. It happens to speak the TRMNL "bring your own server" wire
protocol — that's the bridge to the hardware, not the purpose of the project.

The intent is for the **Device** to behave as inconspicuous decor most of the time and to surface
information only when it's actually time-relevant: morning departures during the commute window, a
calendar item when one is approaching, an art photo when nothing else is interesting. The default
state is "quiet"; informativeness is the exception, not the rule.

## What this is not

- Not a hosted service. Not multi-tenant. Not multi-Device.
- Not a general-purpose product. No auth, no users, no admin permissions.
- Not a UI-first plugin authoring environment. Plugins are written in code, by the same person who
  runs the **Server**.
- Not a competitor to the official TRMNL servers or to other BYOS implementations. They serve a
  broader audience; this serves one person.
- Not stable. The contracts here change when the author's thinking changes, because there is no
  other operator to support.

## North Star

A long-term goal that isn't built today but shapes the architecture: a **Super-Plugin** that
composes other **Plugins** as plain code, so the same **Device** can be a departure board during
commute hours, a calendar view before meetings, a passive photo at all other times — without the
**Server** knowing or caring which mode is active. The **Plugin** contract is designed so this
composition happens entirely in user code, never via **Server**-side orchestration.

## Why this framing matters

The "personal and opinionated" framing licenses choices that would be wrong for a general-purpose
product:

- Breaking changes happen freely. Single user, atomic switches, no migration paths.
- The **Plugin** contract is small and prescriptive. Authors who don't like it can fork.
- Configuration lives in code and env vars; no admin UI ever (for now).
- Decisions favor clarity over flexibility, and "what I want to build for myself" over "what someone
  else might want."

If at some point another engineer wants to use this, they can.

## Related

- [CONTEXT.md](../CONTEXT.md) — vocabulary and contract
- `docs/adr/` — architectural decisions
- `docs/migration.md` — moving from the older shape to the target
