# 0010 — Mounted `config/` folder, edited via webproc

**Status:** Accepted

## Context

The system is being deployed to a Raspberry Pi 5 over Docker. Today configuration is split and
redeploy-bound: Server knobs are read from environment variables through `src/config.ts`, and the
transport rules live in a gitignored `templates/example/transport/bvg/routes.ts` copied by hand from
an `.example.ts`. Changing anything — a commute rule, the device profile, the public origin — means
editing files baked into the image and rebuilding/redeploying.

The goal: settings editable at runtime without a redeploy, persisted across container rebuilds,
collected in **one** mountable location, with the local `deno task dev` flow preserved. We
explicitly do not want to hand-build a settings UI, a JSON schema, or a validate-before-restart
safety net — those were considered and judged overkill for a single-Device personal appliance.

## Decision

### One mounted `config/` folder that mirrors the plugin tree

All user-provided settings live in a top-level `config/` directory, mounted as the Docker volume so
it survives rebuilds. Its structure **mirrors the plugin source tree** so a file's path tells you
its consumer without grepping the code:

```
config/                          # single mounted volume; mirrors templates/example/
├── system.ts                    # Server infra (port, cdpUrl, loopbackHost, deviceId,
│                                # publicUrlOrigin, pluginDir) — the one non-plugin file, no env parsing
└── plugins/
    ├── composition.ts           # root Super-Plugin config — reserved; created only when composition
    │                            # gains a configurable knob (mirrors templates/example/main.ts)
    ├── transport/
    │   └── routes.ts            # transport leaf rules (moved out of templates/example/transport/bvg/)
    └── gallery/
        └── images/              # drop-folder of photos, scanned by the Gallery plugin
```

Ownership is encoded in the path: `config/plugins/transport/routes.ts` mirrors
`templates/example/transport/`, so the consumer is obvious from the location. Leaf plugins get
folders; the root Super-Plugin is the bare `plugins/composition.ts`; `system.ts` sits at the config
root _because_ it configures the Server, not a plugin. No empty `composition.ts` is created up front
— the convention is reserved and the file appears the day composition gets its first knob.

The config files are gitignored and copied from committed `*.example.ts` starters, the same pattern
`routes.ts` already used. Per-environment differences (dev `127.0.0.1` vs. compose vs. Pi) live in
each environment's own mounted `system.ts`, not in code branches.

### `src/config.ts` and env-var loading are removed

`src/config.ts` (the `env()` helper, the `parseInt`/default boilerplate, the exported constants) is
deleted. The app imports `config/system.ts` directly as a typed object; `ACTIVE_PROFILE` becomes
`getProfile(system.deviceId)` at wiring time in `main.ts`. Configuration is no longer sourced from
environment variables. The device-profile registry (`src/render/profiles.ts`, ADR-0006) is unchanged
— only the _source_ of `deviceId` and the Server knobs moves from env to `system.ts`.

### Plugins keep importing their own config

The transport plugin imports `config/plugins/transport/routes.ts` directly (via an import-map alias,
which also keeps its type imports resolving once the file leaves `templates/`). No config blob is
threaded through the plugin contract; **ADR-0002's "the plugin receives nothing" stands** — config
arrives by `import`, as it always did. "Pass config into a plugin factory" was rejected as a
contract change that adds work without simplifying anything.

### Editing and apply are delegated to webproc

[jpillora/webproc](https://github.com/jpillora/webproc) (multi-arch; native `linux/arm64` binary)
wraps the Deno process, serves a browser editor for `config/system.ts` and
`config/plugins/transport/routes.ts`, and restarts the process on save:

- `--on-save restart` — a save bounces the Deno process; the new config is read on boot.
- `--on-exit ignore` — a bad edit (syntax error) crashes the boot; webproc waits and surfaces the
  crash log in its own UI for in-place fixing, rather than crash-looping.
- webproc is the supervisor, so no separate Docker restart policy is needed for app crashes.

webproc's `-c` takes individual file paths only — no directory, no glob, no auto-discovery — so a
container entrypoint script (`docker/entrypoint.sh`) discovers the editable set at start: it globs
every `*.ts` under `config/` (minus the committed `*.example.ts` starters) into `-c` flags, then
`exec`s webproc supervising the Deno process. The `CMD` never needs editing as plugins are added; a
newly added config file becomes editable on the next restart (adding a plugin is a deploy).
`config/plugins/gallery/images/` is binaries, not `*.ts`, so it falls outside the glob for free. The
resulting invocation is roughly:
`webproc -c config/system.ts -c config/plugins/transport/routes.ts … --on-save restart --on-exit ignore -- deno run --allow-all src/main.ts`.

### Two web surfaces, no proxy

The app/dashboard stays on `:3000` (public); webproc's editor is on `:8080`, bound local-only and
behind basic auth + IP allowlist. No reverse proxy in v1 — host port-mapping is enough. An
integrated editor inside the dashboard is a possible later follow-up if the split proves annoying.

### Gallery images are out of webproc's scope

webproc edits text config, not binary uploads. For v1 `config/plugins/gallery/images/` is a mounted
drop-folder (populated by scp/Samba/Syncthing); the Gallery plugin scans it. An in-dashboard upload
route is deferred.

## Considered options

- **In-app settings page** — config as JSON data read at runtime inside `run()`, edited through a
  dashboard form, validated on save so a typo can never darken the display, no restart. More to
  build (forms, schema, validation) and a second UI surface to design. Rejected for v1 on effort.
- **webproc** — near-zero build, reuses a battle-tested supervisor + editor, keeps config as plain
  TS files. Costs: a second web surface, restart-on-every-save, and a typo crashes the boot until
  fixed. **Chosen** for the effort profile; the integrated editor remains a clean later upgrade.

## Consequences

- A syntax error in a saved config file fails the Deno boot. webproc shows the log for in-place
  repair, but the panel serves no fresh Image until it's fixed. Accepted for a single-Device
  personal appliance.
- Clean code/config split: code is baked into the image, all settings live in the mounted volume.
- Deleting `src/config.ts` removes the env boilerplate the author disliked; there are no environment
  variables in the configuration path anymore.
- ADR-0002 is untouched in substance — plugins still receive nothing and import their own config.
