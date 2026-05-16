# Migration

Placeholder for the migration plan from the current `template` / `setup` / `onDisplay` shape to the
**Plugin** / `snapshot` / `present` model defined in [CONTEXT.md](../CONTEXT.md) and the ADRs.

This file exists to capture context; the actual migration is being worked through a PRD in a
separate flow. Do not treat anything here as the source of truth for _how_ the migration happens —
the PRD will be.

## What's being migrated, at a glance

| Today                                                              | Target                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `template` (codebase term + `templates/` dir + `TEMPLATE_DIR` env) | **Plugin** (term, dir, env)                                                                      |
| `setup(config: SetupConfig): Registration`                         | `default function (): Plugin`                                                                    |
| `onDisplay(): { jsx, validForSeconds }`                            | `snapshot(t) → Sample { state, validity }` + `present(sample) → Presentation { view, ...hints }` |
| `Date`, `validForSeconds: number`                                  | `Temporal.ZonedDateTime`, `Temporal.Duration`                                                    |
| Server holds one in-flight render + LRU of jobs                    | Server holds **Current Sample** + **Current Image**; identity-comparison on HTML hash            |
| `getDevice()` injected into setup config                           | Plugin owns its own config; no SetupConfig                                                       |
| Existing ADRs (0001–0008) describing old shape                     | Clean-slate ADRs reflecting the target model                                                     |

## Things that don't change

- Hono as HTTP framework.
- CDP/CloakBrowser rasterization pipeline.
- Floyd-Steinberg dithering and panel profile registry.
- BYOS wire protocol (`/api/setup`, `/api/display`, `/api/log`).
- Content-derived **Image** identity (filename) for Device-side SPIFFS cache hits.

## Things explicitly out of scope for the migration

- Multi-Device, multi-tenant, auth — never in scope.
- Hot-reload, in-process restart — defer until needed.
- `DeviceReport` surface (battery, RSSI exposure to Plugin) — deferred.
- Caller intent in `snapshot` — deferred.
- Future-Sample pre-commitment — deferred.

## See also

- [CONTEXT.md](../CONTEXT.md) — vocabulary and contract
- `docs/adr/` — architectural decisions reflecting the target
- `docs/vision.md` — what this project is and isn't
