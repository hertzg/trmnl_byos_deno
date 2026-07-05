# 0009 — Super-Plugin asset composition: a single merged `assets/` tree

**Status:** Accepted

## Context

ADR-0002 defined the **Plugin** contract and the `pluginDir/assets/` folder convention:
**PluginManager** reads one Plugin's `assets/` directory recursively at load time and attaches the
resulting `Record<urlPath, Uint8Array>` to every **Bundle**. ADR-0002 explicitly deferred one
question: "How a Super-Plugin aggregates its sub-Plugins' `assets/` directories is deferred … Until
a concrete Super-Plugin exists, the folder convention applies to the outermost Plugin only."
CONTEXT.md carried the same deferral as the "Composition asset story" open question.

The first concrete **Super-Plugin** now exists: it routes between **Transport** (the BVG departure
board) and **Gallery** (a full-screen photo). The Super-Plugin is the deployed Plugin, so
PluginManager reads _its_ `assets/`. But when the Super-Plugin delegates to Transport's view, that
view references `/assets/bvg/*.svg`, `/assets/fonts/*.woff2`, `/assets/style.css` — bytes that must
be in the Bundle, or the screenshot shows broken images. Gallery's view references
`/assets/gallery/*`.

Three candidates were on the table (the same three CONTEXT.md named):

- **A — One merged tree, the Super-Plugin owns it.** The deployed Super-Plugin has a single
  `assets/` directory holding every sub-Plugin's assets. No PluginManager change, no contract
  change, no leaf code change.
- **B — PluginManager reads multiple asset roots.** A loader change: the deployed Plugin declares
  extra asset roots; PluginManager merges the maps. Leaves keep co-located `assets/`.
- **C — Render-time inlining.** Each leaf inlines its assets as data URIs; there are no `/assets/*`
  URLs and nothing to merge.

A favourable accident makes A cheap: leaf Plugins already namespace their assets into distinct
subfolders (`bvg/`, `fonts/`, `gallery/`) — plus Transport's lone top-level `style.css`. Those
namespaces do not collide, so a merged tree needs **no URL rewriting**: every view's `/assets/...`
path resolves identically whether the leaf runs standalone or composed.

## Decision

A Super-Plugin owns a single `assets/` directory — the merged union of its sub-Plugins' asset trees.
Leaf Plugins composed into a Super-Plugin are **code-only modules**; they do not carry their own
`assets/` directory in the deployed unit. PluginManager is unchanged: it still reads exactly one
`assets/` directory, the deployed (outermost) Plugin's.

Layout of the deployed Super-Plugin:

```
templates/example/        ← the Super-Plugin (deployed; PLUGIN_DIR points here)
  main.ts                 ← routes Transport ↔ Gallery
  assets/                 ← the single merged tree
    bvg/  fonts/  style.css   ← Transport's assets
    gallery/                  ← Gallery's images
  transport/              ← Transport leaf, code only
  gallery/                ← Gallery leaf, code only
```

This works without URL rewriting because leaf asset namespaces are collision-free. Should two leaves
ever collide, the resolution is to rename one leaf's subfolder — not to add machinery.

## Consequences

- The Plugin contract, the Bundle shape, PluginManager, and the Renderer are all unchanged. The
  "small contract" property of ADR-0002 and the "no Server-side orchestration" stance of ADR-0006
  are preserved.
- A leaf Plugin composed into a Super-Plugin is not independently _rasterizable_ — its assets live
  in the parent. It remains independently _runnable_ (`run(ctx) → Result` needs no assets) and so
  unit-testable. The Dashboard always scrubs the deployed Plugin (the Super-Plugin), so standalone
  leaf rasterization is not a real workflow.
- The merged tree is maintained by hand — drop files into the Super-Plugin's `assets/`. No build
  step, no copy script, no symlinks; consistent with the no-build Deno posture.
- Asset collisions between leaves are possible in principle and would be silent. The single-user
  posture (ADR-0001) accepts this; the convention is "each leaf namespaces its own subfolder."
- B and C are rejected. B adds Server-side machinery and a contract addition for a problem that
  plain folder layout already solves. C would force every leaf to inline assets as data URIs —
  rewriting Transport's asset handling and bloating every rendered HTML with inlined `woff2` fonts.
- This resolves the "Composition asset story" open question in CONTEXT.md and the deferral in
  ADR-0002.
