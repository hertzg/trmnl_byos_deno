# Architecture Decision Records

Each ADR captures a single decision with its context and consequences.

| # | Title | Status |
|---|---|---|
| [0001](0001-service-charter.md) | Service charter: runtime + proxy + render primitive | Accepted (revised by 0006/0007) |
| [0002](0002-render-token-protocol.md) | Token-based render protocol between service and template | Superseded by 0006 |
| [0003](0003-template-module-shape.md) | Template module shape: `setup` returning `{ onDisplay }` | Accepted (revised by 0006) |
| [0004](0004-http-framework-hono.md) | HTTP framework: Hono | Accepted |
| [0005](0005-drop-query-overrides-and-preview.md) | Drop /image.png query overrides, preview route, and kind distinction | Accepted |
| [0006](0006-frame-coordinator.md) | Frame coordinator: single-flight, validity-driven, job-id correlation | Accepted |
| [0007](0007-preview-url-namespace.md) | Unified `/preview/*` URL namespace, live vs. addressed | Accepted |

## Format

Each ADR follows:

- **Context** — what's the situation; what forces are at play.
- **Decision** — what we're doing.
- **Consequences** — what becomes true / easier / harder as a result.

Decisions are immutable once accepted. To change one, write a new ADR that supersedes it.
