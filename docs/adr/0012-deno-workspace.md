# 0012 — Deno workspace: `@hztrmnl` packages, config-as-package, loader death

**Status:** Accepted

## Context

The repository layout lied about the architecture. `templates/` held two unrelated things — the
DesignSystem and the deployed Super-Plugin — under a name CONTEXT.md had flagged as a rename-pending
misnomer. The root `deno.jsonc` carried an alias soup (`@ds`, `@transport/`, `@config/`) whose
entries had to be mirrored into `templates/example/deno.json` so the nested tree could be checked
standalone; PR #108 demonstrated the disease live by mirroring `hafas-client` (plus its
trailing-slash subpath alias) into both files.

`pluginDir` did two jobs — locate `main.ts` for a dynamic `import()` behind runtime duck-typing
(`loader.ts`), and locate an `assets/` folder for recursive scanning. Because the plugin graph was
only reachable dynamically, `deno cache src/main.ts` couldn't see it, and the Dockerfile needed a
hand-maintained extra cache line (`deno cache templates/example/transport/bvg/journey_client.ts`) so
the Pi container wouldn't reach npm at boot.

Spike-verified on Deno 2.9: workspace members resolve each other by bare package name with zero
import-map entries; member `imports` are scoped (a member cannot use another member's aliases —
which also means a root `@config/` alias cannot serve member files); config-as-member works with
explicit subpath exports (wildcard exports do not exist); package-level dependency cycles are fine
while the module graph stays acyclic.

## Decision

**1. Deno workspace, six members, scope `@hztrmnl`.**

```
/
├── deno.jsonc         # workspace members + shared fmt/lint/unstable/tasks; ZERO imports
├── server/            # ← src/ + scripts/        @hztrmnl/server
├── ds/                # ← templates/ds/          @hztrmnl/ds
├── plugins/
│   ├── home/          # ← templates/example/     @hztrmnl/home   (the deployed Super-Plugin)
│   ├── transport/     # ← templates/example/transport/   @hztrmnl/transport
│   └── gallery/       # ← templates/example/gallery/     @hztrmnl/gallery
└── config/            #                           @hztrmnl/config
```

The plugin members are listed as a glob (`"./plugins/*"`), and the Dockerfile's manifest layer globs
member `deno.jsonc`s the same way (`COPY --parents`, BuildKit labs frontend) — adding a plugin is
creating a folder; neither file is edited. Every manifest is `deno.jsonc`, root and members alike,
so commentary is first-class everywhere.

Members import each other by bare package name (`name` + `exports` in each member's `deno.jsonc`).
No path aliases anywhere; third-party deps live in the member that uses them (`hafas-client` in
`@hztrmnl/transport`, once). Leaves sit flat under `plugins/` — nesting inside the Super-Plugin is
legal but buys nothing when imports are by name. `home` replaces the rejected "example" name;
`templates/` dies. The root keeps `fmt`/`lint`/`unstable` and task definitions (members inherit
them) but no `imports` — "no aliases at root" is the principle, not "no config at root".

**2. Config is a package whose skeleton is code and whose content is mounted (ADR-0010 intact).**
The package skeleton — `config/deno.jsonc` (name + exports) and the committed `*.example.ts`
starters — is baked into the image and never editable at runtime; workspace discovery never depends
on mount content. All mutable content lives under `config/live/`, and _that_ is the bind-mount
boundary (`./config/live:/app/config/live` — the host keeps live files under the same `config/live/`
path the repo gitignores, so the clone-based deploy flow and the mount agree; mounting the whole
`./config` dir would nest the committed skeleton and the live tree one level too deep inside the
container). The public surface is explicit subpath exports, one line per module a consumer imports,
pointing at live files (`"./system": "./live/system.ts"`) so consumers import
`@hztrmnl/config/system` with no `live/` in the specifier; no barrel (a barrel would fuse
`system.ts` and per-plugin config into one module-graph node and create a real ESM cycle through the
plugin packages). Entrypoint seeding reduces to one rule: baked example → `live/<same-path>.ts` when
missing. Wiring a _new_ config module costs one exports line — a code change riding a deploy,
consistent with the existing "adding a plugin is a deploy" posture. Package-level circularity
(config → plugin → config) is deliberate and harmless.

**3. `PLUGIN_DIR` / `pluginDir` and `loader.ts` die.** `config/system.ts` imports the deployed
Plugin package by name and hands the object to the Server (`system.plugin`). Choosing a Plugin is
editing one import line in the webproc editor; a wrong shape is a boot-time type error
(`satisfies SystemConfig`), not a runtime probe. The Plugin contract stays exactly ADR-0002's
`run(ctx) → Result`. Asset scanning still needs a path until the byte-handling work lands, so
`system.ts` carries an interim `pluginAssetsDir` field — deliberately a config field rather than a
Plugin-package export, so the follow-up deletes a line instead of clawing back public surface.
ADR-0009's merged `assets/` tree remains the live asset mechanism, paths updated.

**4. Builds are lockfile-frozen.** `deno.lock` (one, at the workspace root) leaves `.dockerignore` —
it was lumped into the hygiene grab-bag in PR #98 with no recorded reason — and the image builds
with `deno cache --frozen`. With the plugin statically reachable from the entrypoint
(config/system.ts → `@hztrmnl/home` → `@hztrmnl/transport` → `hafas-client`, including
statically-analyzable dynamic imports), one `deno cache server/src/main.ts` covers the whole graph:
PR #108's extra Dockerfile cache line is deleted, not ported. Runtime stays unfrozen — mounted
config may add imports; that fails loud at boot, per ADR-0010.

## Consequences

- The Server shrinks: `loader.ts`, `loader.test.ts`, and `isPlugin` duck-typing are deleted;
  `createPluginManager` takes `{ plugin, assetsDir, extraAssetRoots }`.
- One dependency, one declaration: no more alias mirroring between root and nested manifests.
- `deno check` / `deno test` at the root cover every member; each member is independently checkable
  by name resolution, no standalone alias copies.
- The operator cannot break the config package: `deno.jsonc` and the starters are image-owned; an
  empty mount boots into seeded starters. webproc lists only `config/live/**/*.ts` — the skeleton is
  plumbing, not config.
- `.gitignore`/`.dockerignore` config entries collapse to one line each (`config/live/`), replacing
  the per-file live-copy patterns.
- Every config module a Plugin imports costs one explicit exports line (no wildcard exports in
  Deno). Accepted ceremony.
- The image build is reproducible against the committed lock; drift fails the build instead of
  resolving silently.
- Both compose files mount `./config/live:/app/config/live`. The existing Pi needs a one-time
  migration: move its live files into a `live/` subdir and update its compose copy.
  `docker-compose.yml` dev bind mounts also follow the tree (`./src` → `./server`, `./templates` →
  `./ds` + `./plugins`), and the gallery drop-folder becomes `config/live/plugins/gallery/images/`.
- The byte-handling redesign (ByteStore, Refs, Collections, identity) explored alongside this
  decision is **not** part of it; it arrives, if at all, as its own ADR. Until then Bundles carry
  asset bytes and identity stays `hash(html + assets)` per ADR-0003/0004.
