# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single **TRMNL X** e-ink device, written in Deno.

The service is a thin proxy. You write a template (JSX, Deno); the service runs it, hands the JSX to a [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) sidecar over CDP, dithers the screenshot to a 4-bit grayscale PNG, and serves it to the device. Token-based render cache (LRU 16) — same JSX → same bytes → same token, repeat polls hit the cache.

Architecture is documented under [docs/adr/](docs/adr/).

## What it does

Implements the BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus `/render/:token` (device-facing image) and `/preview/:stashKey` (internal CDP fetch-back seam). Output is a 4-bit grayscale PNG (color-type=0, packed 2 px/byte — exactly what TRMNL X firmware expects).

Out of scope: auth, multi-device, firmware updates, plugin proxying, OG TRMNL — that path is well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite).

## Quick start (Docker)

```sh
cp .env.example .env
# set PUBLIC_URL_ORIGIN to a URL your device can reach (e.g. your host's LAN IP)
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

The service talks to a CloakBrowser CDP container. Run the browser as a sidecar and point the app at it:

```sh
docker run --rm -d --name trmnl-chrome -p 127.0.0.1:9222:9222 \
  cloakhq/cloakbrowser cloakserve
cp .env.example .env
# CDP_URL=http://127.0.0.1:9222 in .env
deno task dev
```

To see the rendered output, hit `/api/display` to materialize a token, then fetch the `image_url` it returns.

**macOS / Colima users**: the default Colima mount (9p) does not propagate inotify events into the VM, so `deno --watch` will not reload on edits. Switch Colima to `virtiofs`:

```sh
colima stop
colima start --mount-type virtiofs --vm-type vz
```

(Apple Silicon required for `--vm-type vz`.) Docker Desktop and OrbStack handle this correctly out of the box.

## Configuration

| Env | Required | Description |
|---|---|---|
| `PUBLIC_URL_ORIGIN` | no | URL the device uses to fetch the image. Default uses the request's `Host`/`X-Forwarded-*` headers. |
| `INTERNAL_URL_ORIGIN` | no | URL CDP uses to fetch back rendered HTML. Default `http://host.docker.internal:${PORT}`. |
| `CDP_URL` | no | HTTP base of the CloakBrowser CDP sidecar. Default `http://localhost:9222`. |
| `PORT` | no | Server port. Default `3000`. |
| `REFRESH_RATE_SECONDS` | no | Fallback refresh rate the device respects when the template doesn't override. Default `3000`. |
| `FRIENDLY_ID` | no | Returned in `/api/setup`. Default `TRMNL`. |
| `TEMPLATE_DIR` | no | Absolute path to the template directory. Default `./templates/example`. |
| `TEMPLATE_SEED_DIR` | no | If `TEMPLATE_DIR` is empty on boot, copy this directory into it once. Used in Docker so a bind-mount gets seeded with the bundled example on first run. |

TRMNL X panel geometry (1872×1404 native, 1040×780 CSS @ DPR 1.8, 4-bit grayscale, Floyd-Steinberg) is set in [src/config.ts](src/config.ts) under `RENDER_DEFAULTS`.

## Writing your own screen

A template is a Deno module exporting a single `setup` function. The runtime calls it once at boot; you return an `onDisplay` handler that the service calls each time the device polls.

```ts
// templates/your-template/main.ts
import type { Registration, Services } from "../../src/template/loader.ts";
import Card from "./Card.tsx";

export function setup(services: Services): Registration {
  return {
    async onDisplay(ctx) {
      // ctx.device — { id, panel, headers } from firmware
      // services.renderJsx(jsx) — JSX → device-ready PNG token
      const token = await services.renderJsx(<Card data={await fetchData()} />);
      return { token, refreshAfter: 60 }; // device polls again in 60s
    },
  };
}
```

That's the **lazy-render** pattern — `renderJsx` is called inside `onDisplay`, so CDP/dither cost is paid on the device's clock.

For **pre-rendering**, do the work in `setup` (or on a `setInterval`) and return a closure variable from `onDisplay`:

```ts
export async function setup(services: Services): Promise<Registration> {
  let token = await services.renderJsx(<Card data={await fetchData()} />);
  setInterval(async () => {
    token = await services.renderJsx(<Card data={await fetchData()} />);
  }, 60_000);
  return {
    async onDisplay() {
      return { token, refreshAfter: 60 };
    },
  };
}
```

Same `services.renderJsx`, same return shape — the difference is *when* you call it. See [ADR-0003](docs/adr/0003-template-module-shape.md) for the full rationale and [ADR-0002](docs/adr/0002-render-token-protocol.md) for how the token cache works.

The bundled template is at [templates/example/](templates/example/). To ship your own, point `TEMPLATE_DIR` at it (or replace `./templates/example`); a `main.ts` exporting `setup` and any companion `.tsx` / `assets/*` is all you need. Files in `assets/` are served at `/assets/*` and so are reachable from your JSX with paths like `<link rel="stylesheet" href="/assets/style.css" />`.

## License

MIT
