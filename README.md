# trmnl_byos_deno

Minimal [BYOS](https://docs.trmnl.com/go/diy/byos) server for a single TRMNL e-ink device, written in Deno.

## What it does

Implements the three BYOS endpoints (`/api/setup`, `/api/display`, `/api/log`) plus `/image` that serves an 800×480 1-bit BMP rendered from `templates/default.html` via headless Chromium.

No database, no multi-device, no firmware updates, no plugin proxying. Edit `templates/default.html` to change what the device shows.

## Quick start (Docker)

```sh
cp .env.example .env
# fill in BYOS_DEVICE_MAC, BYOS_DEVICE_ACCESS_TOKEN, PUBLIC_URL_ORIGIN
docker compose up -d
```

The image is published to `ghcr.io/hertzg/trmnl_byos_deno:latest` on every push to `main`.

## Local dev

Requires Deno 2.x and Chromium installed locally (Astral picks it up automatically).

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

## Customizing the screen

Edit `templates/default.html`. Available placeholders: `${TITLE}`, `${SUBTITLE}`, `${TIME}`, `${HOSTNAME}` (see `src/render.ts` to add more).

The TRMNL [framework CSS](https://usetrmnl.com/framework) is loaded from CDN.

## License

MIT
