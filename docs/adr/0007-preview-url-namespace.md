# 0007 — Unified `/preview/*` URL namespace, live vs. addressed

**Status:** Accepted — 2026-05-09
**Related:** ADR-0006 (frame coordinator), ADR-0001 (charter)

## Context

After ADR-0006, the service holds:

- a canonical `current` frame the device fetches,
- an in-flight render whose HTML CDP fetches back during rasterization,
- and (in dependent slices #14 and #15) a dev-tool surface that triggers
  fresh renders on demand for browser iteration.

The previous architecture split these across three URL prefixes:
`/render/:token` (device), `/preview/:stashKey` (CDP fetch-back), and an
implicit "no preview for developers" (ADR-0005 had killed `/`). Three
prefixes for what are, structurally, four views of the same render
pipeline.

## Decision

A single `/preview/*` namespace, distinguished by **shape**:

| URL                     | Shape                | Who fetches                          |
| ----------------------- | -------------------- | ------------------------------------ |
| `GET /preview`          | live HTML (#14)      | dev (browser)                        |
| `GET /preview/png`      | live PNG (#15)       | dev (browser)                        |
| `GET /preview/:jobId`   | addressed HTML       | CDP, internally; dev for debug       |
| `GET /preview/:jobId/png` | addressed PNG     | device firmware                      |

The discriminator is path shape, not naming convention:

- **Live forms** (`/preview`, `/preview/png`) take no key. They trigger a
  fresh `onDisplay` invocation against a synthetic context derived from
  the active device profile, then exit at one of the pipeline stages
  (HTML for `/preview`, full PNG for `/preview/png`). They do not mutate
  `current` or `inFlight` and serve with `cache-control: no-store` so
  browser refresh = re-render.
- **Addressed forms** (`/preview/:jobId`, `/preview/:jobId/png`) look up
  by job id in the coordinator's `jobs` LRU. CDP fetches the HTML form
  during `ensureFrame`; the device fetches the PNG form following
  `image_url` from `/api/display`. Eviction = 404.

The literal `png` segment is reserved against parameter binding; UUIDs
and sha-256-hex tokens cannot equal `"png"`, so routing precedence
("literal beats param") is enforced by Hono's matcher and the format of
ids we mint.

## Consequences

- **Symmetry surfaces in the route table.** Anyone reading the routes
  sees that the dev tool and the device fetch the same pipeline at
  different binding points. The architectural insight is encoded
  structurally, not described in a comment.
- **No internal/external naming split.** The previous `/preview/:stashKey`
  was misnamed (it wasn't a preview; it was an HTML stash for CDP).
  Renaming it via promotion to `/preview/:jobId` removes the lie.
- **`/render/:token` is retired.** Devices follow `image_url` from
  `/api/display`; firmware doesn't construct that URL itself, so the
  rename is invisible to deployed devices.
- **Routing precedence is enforced by id format, not configuration.**
  UUIDs and hex tokens cannot collide with the literal `"png"` segment,
  so route registration order doesn't have to defend against it.
- **Live and addressed paths share implementation.** The live PNG path
  uses the coordinator's `renderEphemeral` (which mints a fresh job in
  the shared LRU); the addressed PNG path is `coordinator.getJobPng`.
  Both produce/consume entries in the same LRU.

## Notes

- The dev tool's live routes are out of scope for this slice (#13). They
  land in #14 (`/preview`) and #15 (`/preview/png`). The acceptance
  criteria for #13 cover only the addressed forms and the routing
  precedence invariant.
- ADR-0005's posture (no preview/device split at the user-code layer)
  is preserved. The split exists in URL space, not in the template
  contract.
