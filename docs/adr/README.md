# Architecture Decision Records

Each ADR captures a single decision with its context and consequences.

| #                               | Title                                               | Status   |
| ------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-service-scope.md)   | Service scope and intent                            | Accepted |
| [0002](0002-plugin-contract.md) | Plugin contract: `snapshot(t)` + `present(sample)`  | Accepted |
| [0003](0003-render-pipeline.md) | Render pipeline, Current Sample, and Current Image  | Accepted |
| [0004](0004-caching.md)         | Two-layer caching: state hash + Image identity      | Accepted |
| [0005](0005-http-layer.md)      | HTTP layer: Hono, routing, and the dashboard at `/` | Accepted |
| [0006](0006-non-features.md)    | Explicit non-features                               | Accepted |

## Format

Each ADR follows:

- **Context** — what's the situation; what forces are at play.
- **Decision** — what we're doing.
- **Consequences** — what becomes true / easier / harder as a result.

ADRs in this project reflect current intent. When intent shifts, the relevant ADR is rewritten and
the prior version stays in git history.
