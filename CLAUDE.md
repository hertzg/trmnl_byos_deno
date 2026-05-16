# Project guidance for Claude

This is a personal, opinionated back end for a single TRMNL e-ink display. It is not a
general-purpose product. Before doing substantive work in this repository, read:

- [docs/vision.md](docs/vision.md) — what this project is and isn't. Read this first; it explains
  why decisions look the way they do.
- [CONTEXT.md](CONTEXT.md) — domain vocabulary (Device, Server, Plugin, RunContext, Result,
  Conductor, Renderer, Image, Current Result, Current Image) and how the terms relate.
- [docs/adr/](docs/adr/) — architectural decisions in their current target form. Clean-slate; old
  ADRs are superseded.
- [docs/migration.md](docs/migration.md) — what's moving from the older `template`/`onDisplay`
  shape to the **Plugin**/`run`/`Result` model.
- [docs/plugin-authoring.md](docs/plugin-authoring.md) — practical guide for writing a Plugin
  (factory pattern, two mental modes for `run`, common traps, worked example, composition layout).

## House rules

- The user owns and runs the only Device. Breaking changes are fine; there is no other operator to
  support.
- The Plugin contract is `run(ctx: RunContext) → Result`. The Result carries `state`, `validity`,
  optional `hints`, and `view`. Importing a Plugin module never activates anything; the
  default-exported factory does.
- `Temporal.ZonedDateTime` for moments, `Temporal.Duration` for `validity`. Not `Date`.
- Composition of multiple display modes lives inside a Super-Plugin, never in the Server.
- The dashboard at `/` is a Plugin-debugging surface, not just a preview.
- Don't write authoring guides, PRDs, or large speculative documents without being asked — the user
  manages those flows separately.
