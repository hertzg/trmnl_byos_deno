# Migration

Placeholder for the migration plan from the current `template` / `setup` / `onDisplay` shape to the
**Plugin** / `run` / `Result` model defined in [CONTEXT.md](../CONTEXT.md) and the ADRs.

This file exists to capture context; the actual migration is being worked through a PRD in a
separate flow. Do not treat anything here as the source of truth for _how_ the migration happens —
the PRD will be.

## What's being migrated, at a glance

| Today                                                              | Target                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `template` (codebase term + `templates/` dir + `TEMPLATE_DIR` env) | **Plugin** (term, dir, env)                                                             |
| `setup(config: SetupConfig): Registration`                         | `default function (): Plugin`                                                           |
| `onDisplay(): { jsx, validForSeconds }`                            | `run(ctx: RunContext) → Result { state, validity, hints?, view }`                       |
| `Date`, `validForSeconds: number`                                  | `Temporal.ZonedDateTime`, `Temporal.Duration`                                           |
| Server holds one in-flight render + LRU of jobs                    | **Conductor** holds **Current Result** + **Current Image**; identity = hash(HTML)       |
| Render pipeline implicit in Server                                 | **Renderer** as internal Server module: `deriveHtml(result)` + `rasterize(html, hints)` |
| `getDevice()` injected into setup config                           | Plugin owns its own config; device telemetry rides in `RunContext.device` instead       |
| Existing ADRs (0001–0008) describing old shape                     | Clean-slate ADRs reflecting the target model (0001–0007)                                |

## Things that don't change

- Hono as HTTP framework.
- CDP/CloakBrowser rasterization (now `Renderer.rasterize`'s implementation detail).
- Floyd-Steinberg dithering and panel profile registry.
- BYOS wire protocol (`/api/setup`, `/api/display`, `/api/log`).
- Content-derived **Image** identity (filename) for Device-side SPIFFS cache hits.

## Things explicitly out of scope for the migration

- Multi-Device, multi-tenant, auth — never in scope.
- Hot-reload, in-process restart — defer until needed.
- Concrete shape of `RunContext.device` — `RunContext` reserves the field; exactly what's in it is
  deferred (see CONTEXT.md "Open questions").
- Future-Result pre-commitment beyond the prerender warm-up (ADR-0007) — deferred.
- Plugin-folder vs. TS-module decision and the asset-handling story under composition — deferred
  (see CONTEXT.md "Static assets and styling").

## See also

- [CONTEXT.md](../CONTEXT.md) — vocabulary and contract
- `docs/adr/` — architectural decisions reflecting the target
- `docs/vision.md` — what this project is and isn't
