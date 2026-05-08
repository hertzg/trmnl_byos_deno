# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single **TRMNL X** e-ink device, written in Deno.

Single file. No caching. No auth. Each request: read template → render in a [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) sidecar over CDP → Floyd-Steinberg dither to 4-bit grayscale PNG → respond.

## What it does

Implements the three BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus `/image.png` that serves a 4-bit grayscale PNG (1872×1404, color-type=0, packed 2 px/byte — exactly what the firmware expects) rendered from `templates/default.html`. The browser sidecar is reached over CDP (WebSocket); dithering and PNG packing are pure TypeScript (no ImageMagick).

No auth, no database, no multi-device, no firmware updates, no plugin proxying, no OG TRMNL support — that path is well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite). Edit `templates/default.html` to change what the device shows.

## Quick start (Docker)

```sh
cp .env.example .env
# set PUBLIC_URL_ORIGIN to a URL your device can reach (e.g. your host's LAN IP)
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

```sh
docker compose up --build
# then open http://127.0.0.1:3000/image.png (preview) or http://127.0.0.1:3000/ (HTML)
```

**macOS / Colima users**: the default Colima mount (9p) does not propagate inotify events into the VM, so `deno --watch` will not reload on edits to `src/`. Switch Colima to `virtiofs` once:

```sh
colima stop
colima start --mount-type virtiofs --vm-type vz
```

(Apple Silicon required for `--vm-type vz`.) Docker Desktop and OrbStack handle this correctly out of the box. Template edits to `templates/default.html` always take effect on the next request — the file is re-read each render.

### Without Docker (Deno locally, CloakBrowser in Docker)

The app talks to a CloakBrowser CDP container. Run the browser as a sidecar and point the app at it:

```sh
docker run --rm -d --name trmnl-chrome -p 127.0.0.1:9222:9222 \
  cloakhq/cloakbrowser cloakserve
cp .env.example .env
# CDP_URL=http://127.0.0.1:9222 in .env
deno task dev
```

## Configuration

| Env | Required | Description |
|---|---|---|
| `PUBLIC_URL_ORIGIN` | no | URL the device uses to fetch the image. Default `http://localhost:${PORT}` |
| `CDP_URL` | no | HTTP base of the CloakBrowser CDP sidecar. Default `http://localhost:9222` |
| `PORT` | no | Server port, default `3000` |
| `REFRESH_RATE_SECONDS` | no | Poll interval the device respects, default `300` |
| `FRIENDLY_ID` | no | Returned in `/api/setup`, default `TRMNL` |

TRMNL X panel geometry (1872×1404, deviceScaleFactor=1.8, 4-bit grayscale) is hardcoded in [src/main.ts](src/main.ts) and [src/render/dither.ts](src/render/dither.ts).

## Customizing the screen

Edit `templates/default.html`. Available placeholders: `${TIME}`, `${HOSTNAME}` (see `src/main.ts` `vars` to add more).

The TRMNL [framework CSS](https://trmnl.com/framework) is loaded from CDN. Use `screen--v2` (TRMNL X device profile), `screen--lg` (size mode), `screen--4bit`, and optionally `screen--portrait` on the `.screen` div, plus `lg:`, `portrait:`, `4bit:` utility prefixes.

## License

MIT
