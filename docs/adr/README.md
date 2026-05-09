# Architecture Decision Records

Each ADR captures a single decision with its context and consequences.

| # | Title | Status |
|---|---|---|
| [0001](0001-service-charter.md) | Service charter: runtime + proxy + render primitive | Accepted |
| [0002](0002-render-token-protocol.md) | Token-based render protocol between service and template | Accepted |
| [0003](0003-template-module-shape.md) | Template module shape: `setup` returning `{ onPoll }` | Accepted |
| [0004](0004-http-framework-hono.md) | HTTP framework: Hono | Accepted |
| [0005](0005-drop-query-overrides-and-preview.md) | Drop /image.png query overrides, preview route, and kind distinction | Accepted |

## Format

Each ADR follows:

- **Context** — what's the situation; what forces are at play.
- **Decision** — what we're doing.
- **Consequences** — what becomes true / easier / harder as a result.

Decisions are immutable once accepted. To change one, write a new ADR that supersedes it.
