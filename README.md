# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single **TRMNL X** e-ink device,
written in Deno.

The service is a thin proxy. You write a template (JSX, Deno); the service runs it, hands the JSX to
a [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) sidecar over CDP, dithers the screenshot
to a 4-bit grayscale PNG, and serves it to the device. The renderer holds one canonical frame at a
time — within its template-declared validity window, every device poll (and every concurrent poll)
gets the same frame from a single in-flight render.

Architecture is documented under [docs/adr/](docs/adr/).

## What it does

Implements the BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus the unified
`/preview/*` namespace:

- `/preview/:jobId/png` — device-facing image bytes, content delivered from a UUID-keyed LRU
- `/preview/:jobId` — HTML used by CDP during a render (also browsable for debugging)
- `/preview` — live HTML preview for dev iteration (no CDP cost, refresh = re-render)
- `/preview/png` — live PNG preview for dev iteration (full pipeline, refresh = re-render)

Output is a 4-bit grayscale PNG (color-type=0, packed 2 px/byte — exactly what TRMNL X firmware
expects).

Out of scope: auth, multi-device, firmware updates, plugin proxying, OG TRMNL — that path is
well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite).

## Quick start (Docker)

```sh
cp .env.example .env
# set PUBLIC_URL_ORIGIN to a URL your device can reach (e.g. your host's LAN IP)
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

The service talks to a CloakBrowser CDP container. Run the browser as a sidecar and point the app at
it:

```sh
docker run --rm -d --name trmnl-chrome -p 127.0.0.1:9222:9222 \
  cloakhq/cloakbrowser cloakserve
cp .env.example .env
# CDP_URL=http://127.0.0.1:9222 in .env
deno task dev
```

To iterate on a template's HTML (no CDP latency), open `http://localhost:3000/preview` in a browser
and refresh on save. To verify the dithered PNG the device would receive, open `/preview/png`. The
device path is `/api/display` → follow the `image_url` it returns.

**macOS / Colima users**: the default Colima mount (9p) does not propagate inotify events into the
VM, so `deno --watch` will not reload on edits. Switch Colima to `virtiofs`:

```sh
colima stop
colima start --mount-type virtiofs --vm-type vz
```

(Apple Silicon required for `--vm-type vz`.) Docker Desktop and OrbStack handle this correctly out
of the box.

## Configuration

| Env                   | Required | Description                                                                                                                                                                                                                              |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL_ORIGIN`   | no       | URL the device uses to fetch the image. Default uses the request's `Host`/`X-Forwarded-*` headers.                                                                                                                                       |
| `INTERNAL_URL_ORIGIN` | no       | URL CDP uses to fetch back rendered HTML. Default `http://host.docker.internal:${PORT}`.                                                                                                                                                 |
| `CDP_URL`             | no       | HTTP base of the CloakBrowser CDP sidecar. Default `http://localhost:9222`.                                                                                                                                                              |
| `PORT`                | no       | Server port. Default `3000`.                                                                                                                                                                                                             |
| `DEVICE_ID`           | no       | Active device profile id, looked up in [src/render/profiles.ts](src/render/profiles.ts). Determines panel dimensions, dpr, bit depth, and dither mode. Unknown id fails fast at boot with the list of registered ids. Default `trmnl-x`. |
| `FRIENDLY_ID`         | no       | Returned in `/api/setup`. Default `TRMNL`.                                                                                                                                                                                               |
| `TEMPLATE_DIR`        | no       | Absolute path to the template directory. Default `./templates/example`.                                                                                                                                                                  |
| `TEMPLATE_SEED_DIR`   | no       | If `TEMPLATE_DIR` is empty on boot, copy this directory into it once. Used in Docker so a bind-mount gets seeded with the bundled example on first run.                                                                                  |

TRMNL X panel geometry (1872×1404 native, 1040×780 CSS @ DPR 1.8, 4-bit grayscale, Floyd-Steinberg)
lives as a registry entry in [src/render/profiles.ts](src/render/profiles.ts). Adding another device
model is a registry entry, not a sprawl of new env vars.

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

## Writing your own screen

A template is a Deno module exporting a single `setup` function. The runtime calls it once at boot
with the active device profile; you return an `onDisplay` handler that the service calls when it
needs a fresh frame. Templates are **declarative** — they return JSX and a validity in seconds; the
service owns the rendering pipeline and the polling cadence.

```ts
// templates/your-template/main.ts
import type { Registration, SetupConfig } from "../../src/template/loader.ts";
import Card from "./Card.tsx";

export function setup(config: SetupConfig): Registration {
  // config.panel — { width, height } from the active device profile
  return {
    async onDisplay() {
      return {
        jsx: <Card data={await fetchData()} />,
        validForSeconds: 60, // frame is valid for 60s; the device's refresh_rate is derived
      };
    },
  };
}
```

That's the **lazy** pattern — `onDisplay` produces fresh JSX each time the renderer asks. The
renderer asks at most once per `validForSeconds` (concurrent device polls share the same in-flight
render), so CDP cost scales with frame turnover, not fleet size.

For **pre-rendering**, cache the JSX in `setup`'s closure (optionally refreshed on a timer) and
return it from `onDisplay`:

```ts
export async function setup(_config: SetupConfig): Promise<Registration> {
  let jsx = <Card data={await fetchData()} />;
  setInterval(async () => {
    jsx = <Card data={await fetchData()} />;
  }, 60_000);
  return {
    onDisplay() {
      return { jsx, validForSeconds: 60 };
    },
  };
}
```

Same return shape — the difference is _when_ the data fetch happens. The renderer hashes nothing;
each render mints a fresh job id, and unchanged frames simply hit the validity-window cache.

See [ADR-0006](docs/adr/0006-frame-coordinator.md) for the frame coordinator's contract
(single-flight, validity-driven, two-stage error fallback) and
[ADR-0007](docs/adr/0007-preview-url-namespace.md) for the unified `/preview/*` URL namespace.

The bundled template is at [templates/example/](templates/example/). To ship your own, point
`TEMPLATE_DIR` at it (or replace `./templates/example`); a `main.ts` exporting `setup` and any
companion `.tsx` / `assets/*` is all you need. Files in `assets/` are served at `/assets/*` and so
are reachable from your JSX with paths like `<link rel="stylesheet" href="/assets/style.css" />`.

## License

MIT
