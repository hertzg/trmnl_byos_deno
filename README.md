# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single **TRMNL X** e-ink device, written in Deno.

Single file. No caching. Each request: read template → render in Chromium → grayscale via ImageMagick → respond.

## What it does

Implements the three BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus `/image.png` that serves a 4-bit grayscale PNG (1872×1404 landscape by default, 1404×1872 portrait optional) rendered from `templates/default.html` via headless Chromium and quantized via ImageMagick.

No database, no multi-device, no firmware updates, no plugin proxying, no OG TRMNL support — that path is well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite). Edit `templates/default.html` to change what the device shows.

## Quick start (Docker)

```sh
cp .env.example .env
# fill in BYOS_DEVICE_MAC, BYOS_DEVICE_ACCESS_TOKEN, PUBLIC_URL_ORIGIN
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

```sh
docker compose -f compose.dev.yml up --build
# then open http://127.0.0.1:3000/image.png
```

**macOS / Colima users**: the default Colima mount (9p) does not propagate inotify events into the VM, so `deno --watch` will not reload on edits to `src/`. Switch Colima to `virtiofs` once:

```sh
colima stop
colima start --mount-type virtiofs --vm-type vz
```

(Apple Silicon required for `--vm-type vz`.) Docker Desktop and OrbStack handle this correctly out of the box. Template edits to `templates/default.html` always take effect on the next request — the file is re-read each render.

### Without Docker (Deno + Chromium + ImageMagick installed locally)

```sh
cp .env.example .env
deno task dev
```

## Configuration

| Env | Required | Description |
|---|---|---|
| `BYOS_DEVICE_MAC` | yes | MAC of your TRMNL device, any case |
| `BYOS_DEVICE_ACCESS_TOKEN` | yes | Token the device sends in `Access-Token` header |
| `PUBLIC_URL_ORIGIN` | yes | URL the device uses to fetch the image (e.g. `http://10.0.0.5:3000`) |
| `PORT` | no | Server port, default `3000` |
| `REFRESH_RATE_SECONDS` | no | Poll interval the device respects, default `300` |
| `FRIENDLY_ID` | no | Returned in `/api/setup`, default `TRMNL` |
| `ORIENTATION` | no | `landscape` (default, 1872×1404) or `portrait` (1404×1872, firmware rotates) |
| `PIXEL_RATIO` | no | DPR for chromium render, default `1.8` (TRMNL X native) |
| `IMAGE_BIT_DEPTH` | no | `1`, `2`, or `4` (default). 4 = native 16-gray; 1 = pure B/W |

## Customizing the screen

Edit `templates/default.html`. Available placeholders: `${TIME}`, `${HOSTNAME}` (see `src/main.ts` `vars` to add more).

The TRMNL [framework CSS](https://trmnl.com/framework) is loaded from CDN. Use `screen--v2` (TRMNL X device profile), `screen--lg` (size mode), `screen--4bit`, and optionally `screen--portrait` on the `.screen` div, plus `lg:`, `portrait:`, `4bit:` utility prefixes.

## License

MIT
