# Architecture Decision Records

Each ADR captures a single decision with its context and consequences.

| #                                    | Title                                                                                                  | Status    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------- |
| [0001](0001-service-scope.md)        | Service scope and intent                                                                               | Accepted  |
| [0002](0002-plugin-contract.md)      | Plugin contract: `run(ctx) → Result`, assets via folder convention                                     | Accepted  |
| [0003](0003-render-pipeline.md)      | Render pipeline: Plugin → Bundle → Renderer → Image                                                    | Accepted  |
| [0004](0004-caching.md)              | Single-slot Image cache; `validity` drives `refresh_rate`, identity drives the Device's filename cache | Accepted  |
| [0005](0005-http-layer.md)           | HTTP layer: Hono, routing, and the dashboard at `/`                                                    | Accepted  |
| [0006](0006-non-features.md)         | Explicit non-features                                                                                  | Accepted  |
| [0007](0007-prerender-scheduling.md) | Prerender warm-up ahead of Device wake                                                                 | Withdrawn |
| [0008](0008-design-system.md)        | Project-native design system, framework-informed                                                       | Accepted  |

## Format

Each ADR follows:

- **Context** — what's the situation; what forces are at play.
- **Decision** — what we're doing.
- **Consequences** — what becomes true / easier / harder as a result.

ADRs in this project reflect current intent. When intent shifts, the relevant ADR is rewritten
and the prior version stays in git history.
