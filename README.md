# trmnl_byos_deno

Personal, opinionated [BYOS](https://docs.trmnl.com/go/diy/byos) back end for a single **TRMNL X**
e-ink Device, written in Deno.

You write a **Plugin** (a TypeScript module exporting a factory). The Server orchestrates one
Plugin, hands its JSX to a [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) sidecar over CDP,
dithers the screenshot to a 4-bit grayscale PNG, and serves it to the Device. The **Conductor**
holds one Current Image at a time and reuses it across Device polls inside the Result's validity
window — and skips re-rasterization when the next Plugin run produces HTML that hashes to the same
identity.

Architecture is documented under [`docs/adr/`](docs/adr/); vocabulary in [`CONTEXT.md`](CONTEXT.md);
the Plugin author's guide in [`docs/plugin-authoring.md`](docs/plugin-authoring.md); and what this
project is and isn't in [`docs/vision.md`](docs/vision.md).

## What it does

Implements the BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus the routes from
[ADR-0005](docs/adr/0005-http-layer.md):

- `/images/:identity/png` — Device-facing image bytes, served from the Conductor's Current Image
  when its identity matches
- `/preview` — live HTML preview of the current Plugin output at `t = now` (dev iteration, no CDP
  cost)
- `/preview/png` — live PNG preview at `t = now` (dev iteration, full pipeline)
- `/__internal/render/:id` — internal HTML fetch-back used by CDP during rasterization (not
  reachable by the Device; owned by the rasterizer's own Hono sub-app)
- `/assets/*` — static files from the active Plugin's `assets/` directory

Output is a 4-bit grayscale PNG (color-type=0, packed 2 px/byte — exactly what TRMNL X firmware
expects).

Out of scope (and likely to stay out): auth, multi-Device, firmware updates, Plugin proxying, OG
TRMNL — that path is well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite).

## Quick start (Docker)

```sh
cp .env.example .env
# set PUBLIC_URL_ORIGIN to a URL your Device can reach (e.g. your host's LAN IP)
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

The Server talks to a CloakBrowser CDP container. Run the browser as a sidecar and point the app at
it:

```sh
docker run --rm -d --name trmnl-chrome -p 127.0.0.1:9222:9222 \
  cloakhq/cloakbrowser cloakserve
cp .env.example .env
# CDP_URL=http://127.0.0.1:9222 in .env
deno task dev
```

The Renderer owns a loopback HTTP origin that CDP fetches the Bundle (HTML + assets) from. The
default `LOOPBACK_HOST=host.docker.internal` matches this workflow (deno on the host, chrome in
docker reaching the host across the docker bridge); the Renderer hands CDP a URL chrome can resolve
and binds the loopback port on `0.0.0.0` so it's reachable from the docker bridge. On Linux without
`host-gateway`, set `LOOPBACK_HOST=<docker bridge IP>` (e.g. `172.17.0.1`). Compose mode pins
`LOOPBACK_HOST=127.0.0.1` in `docker-compose.yml` because chrome shares the deno container's network
namespace there and the loopback bind keeps the port un-reachable from outside the container.

The Device path is `/api/display` → follow the `image_url` it returns. For dev iteration on a
Plugin's view, open `http://localhost:3000/preview` for live HTML or `/preview/png` for the live
rasterized PNG at `t = now`. The dashboard at `/` (forward-only `t` scrubber for diagnosing
wall-clock-in-view / wall-clock-in-validity bugs) will land in a follow-up slice.

**macOS / Colima users**: the default Colima mount (9p) does not propagate inotify events into the
VM, so `deno --watch` will not reload on edits. Switch Colima to `virtiofs`:

```sh
colima stop
colima start --mount-type virtiofs --vm-type vz
```

(Apple Silicon required for `--vm-type vz`.) Docker Desktop and OrbStack handle this correctly out
of the box.

## Configuration

| Env                 | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL_ORIGIN` | no       | URL the Device uses to fetch the image. Default uses the request's `Host`/`X-Forwarded-*` headers.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `CDP_URL`           | no       | HTTP base of the CloakBrowser CDP sidecar. Default `http://localhost:9222`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `LOOPBACK_HOST`     | no       | Hostname the Renderer hands CDP for its internal loopback origin. Default `host.docker.internal` (deno-task-dev workflow — deno on the host, chrome in docker reaching the host across the docker bridge); the Renderer binds the loopback port on `0.0.0.0` so chrome can reach it. Compose mode pins `127.0.0.1` in `docker-compose.yml` (chrome shares the deno container's network namespace, loopback bind keeps the port un-reachable from outside). On Linux without `host-gateway`, set the docker bridge IP (e.g. `172.17.0.1`). |
| `PORT`              | no       | Server port. Default `3000`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `DEVICE_ID`         | no       | Active device profile id, looked up in [`src/render/profiles.ts`](src/render/profiles.ts). Determines panel dimensions, dpr, bit depth, and dither mode. Unknown id fails fast at boot with the list of registered ids. Default `trmnl-x`.                                                                                                                                                                                                                                                                                                |
| `FRIENDLY_ID`       | no       | Returned in `/api/setup`. Default `TRMNL`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `PLUGIN_DIR`        | no       | Absolute path to the Plugin directory. Must contain a `main.ts` whose default export is a factory returning a Plugin. Default `./templates/example`.                                                                                                                                                                                                                                                                                                                                                                                      |
| `PLUGIN_SEED_DIR`   | no       | If `PLUGIN_DIR` is empty on boot, copy this directory into it once. Used in Docker so a bind-mount gets seeded with the bundled example on first run.                                                                                                                                                                                                                                                                                                                                                                                     |

TRMNL X panel geometry (1872×1404 native, 1040×780 CSS @ DPR 1.8, 4-bit grayscale, Floyd-Steinberg)
lives as a registry entry in [`src/render/profiles.ts`](src/render/profiles.ts). Adding another
device model is a registry entry, not a sprawl of new env vars.

## Troubleshooting

**`CDP /json/version 502` from the app, every render fails.** The CloakBrowser sidecar is up on
`:9222` but its inner Xvfb has a stale `/tmp/.X99-lock`, so every Chrome subprocess exits with
"Missing X server or $DISPLAY" and the CDP multiplexer has nothing to proxy to. Recreate the
container to wipe `/tmp`:

```sh
docker compose rm -sf chrome && docker compose up -d chrome
# or, for a standalone sidecar:
docker rm -f trmnl-chrome && docker run --rm -d --name trmnl-chrome \
  -p 127.0.0.1:9222:9222 cloakhq/cloakbrowser cloakserve
```

A plain restart is not always enough — the lock file survives unless the container's `/tmp` is
re-created.

## Writing your own Plugin

A Plugin is a Deno module whose **default export is a factory** that returns an object with one
method: `run(ctx) → Result`. The Server calls the factory once at boot with the loaded config blob;
the Conductor calls `run(ctx)` on each trigger (Device poll, dashboard scrub, prerender warm-up).

```tsx
// templates/your-plugin/main.tsx
import type { Plugin, RunContext } from "../../src/plugin/plugin.ts";

type State = { greeting: string };

function View(state: State) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
      </head>
      <body>
        <h1>{state.greeting}</h1>
      </body>
    </html>
  );
}

export default function (): Plugin<State> {
  return {
    run(ctx: RunContext) {
      return {
        state: { greeting: `hello at ${ctx.t.toString()}` },
        validity: Temporal.Duration.from({ minutes: 5 }),
        view: View,
      };
    },
  };
}
```

The `Result` you return carries `state` (your data shape), `validity` (a `Temporal.Duration` the
Result stands for), optional `hints` (rasterization hints), and `view` (a function from state to
JSX). The Conductor invokes the view through the Renderer to produce HTML, hashes it for identity,
and re-rasterizes only when identity changes — so a pure view (no `Date.now()`, no closures) lets
the Device skip both download and repaint when nothing visible changed.

`docs/plugin-authoring.md` covers the world-knowledge-layer pattern, when `ctx.intent` matters,
Super-Plugin composition, and the common traps. The bundled example at
[`templates/example/`](templates/example/) is a working reference.

To ship your own Plugin, bind-mount or copy it into `PLUGIN_DIR`. Files in `assets/` are served at
`/assets/*` and reachable from your JSX with paths like
`<link rel="stylesheet" href="/assets/style.css" />`.

## License

MIT
