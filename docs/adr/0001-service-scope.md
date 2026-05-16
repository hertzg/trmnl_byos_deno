# 0001 — Service scope and intent

**Status:** Accepted

## Context

This service sits at the intersection of several pulls: the TRMNL BYOS HTTP protocol (multi-device,
multi-implementation), the author's actual use case (one engineer, one **Device** on one wall), and
the general open-source posture (any published code can be read as a starting point).

Without an explicit scope statement, decisions drift. Should we support multi-Device?
Backwards-compatible **Plugin** contracts? An admin UI for non-engineers? These have very different
answers depending on whether the project is a personal back end or a small product.

## Decision

This is a **personal, opinionated back end for one engineer**, deployed for one **Device** the
author owns. The BYOS protocol is the wire interface to the hardware, not the purpose of the
project.

- **One Device.** No multi-Device routing, no per-Device branching, no device identity in the
  **Plugin** contract.
- **One Plugin.** The **Server** orchestrates exactly one **Plugin**. Multi-mode displays are
  achieved by Super-**Plugins** composing other Plugins as plain code (see ADR-0002) — not by
  Server-side orchestration.
- **No auth, no users, no admin UI.** Configuration is env vars and code. The dashboard at `/` is
  unauthenticated because there is no untrusted party on the network.
- **Breaking changes are fine.** Atomic switches with no migration paths. The author is the only
  operator.

## Consequences

- The **Plugin** contract can be small and prescriptive without supporting a long tail of existing
  Plugins.
- Code uses single-Device assumptions where they simplify (one Current Result, one device-zone, one
  panel profile).
- ADRs describe the _intended_ design, not a backwards-compatible evolution path.
- Anyone forking inherits the same posture: free to break things in their fork.
- Multi-Device, if ever needed, is a focused refactor against concrete pressure — not a speculative
  type-parameterization tax paid today.
