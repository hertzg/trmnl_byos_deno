# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single **TRMNL X** e-ink device, written in Deno.

## What it does

Implements the three BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus `/image.png` that serves a 4-bit grayscale PNG (1404×1872 portrait by default) rendered from `templates/default.html` via headless Chromium and quantized via ImageMagick.

No database, no multi-device, no firmware updates, no plugin proxying, no OG TRMNL support — that path is well-served by [byos_node_lite](https://github.com/usetrmnl/byos_node_lite). Edit `templates/default.html` to change what the device shows.

## Quick start (Docker)

```sh
cp .env.example .env
# fill in BYOS_DEVICE_MAC, BYOS_DEVICE_ACCESS_TOKEN, PUBLIC_URL_ORIGIN
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

### With Docker (recommended — no local Deno/Chromium needed)

```sh
docker compose -f compose.dev.yml up --build
```

Then open:
- **http://127.0.0.1:3000/preview.html** — raw rendered HTML, no chromium roundtrip → fastest iteration on CSS/layout
- **http://127.0.0.1:3000/preview** — PNG screenshot exactly as the device would render it (browsers display PNG; BMP doesn't always)
- **http://127.0.0.1:3000/image** — actual 1-bit BMP the device fetches (download to view)
- Add `?fresh=1` to force re-render bypassing the cache

The `compose.dev.yml` bind-mounts `src/` and `templates/` into the container and runs Deno with `--watch`, so saving a file restarts the server in ~1s. Chromium stays warm in the image — no rebuild on code edits.

Default dev env: MAC `AA:BB:CC:DD:EE:FF`, token `dev-token`, refresh 10s.

### Without Docker (Deno + Chromium installed locally)

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
| `ORIENTATION` | no | `portrait` (1404×1872, default) or `landscape` (1872×1404) |
| `IMAGE_BIT_DEPTH` | no | `1`, `2`, or `4` (default). 4 = native 16-gray; 1 = pure B/W |

## Customizing the screen

Edit `templates/default.html`. Available placeholders: `${TITLE}`, `${SUBTITLE}`, `${TIME}`, `${HOSTNAME}` (see `src/render.ts` to add more).

The TRMNL [framework CSS](https://usetrmnl.com/framework) is loaded from CDN.

## License

MIT
