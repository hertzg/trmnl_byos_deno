#!/bin/sh
# Container entrypoint (ADR-0010): supervise the Deno server with webproc and
# auto-discover the editable config so the -c list never needs hand-maintenance
# as plugins are added.
#
# webproc's -c takes individual file paths only (no dir, no glob), so we glob
# them ourselves at container start: every *.ts under config/, minus the
# committed *.example.ts starters. config/plugins/gallery/images/ is binaries,
# not *.ts, so it's skipped for free. A newly added config file becomes editable
# after the next restart (adding a plugin is a deploy) — acceptable per the ADR.
set -e

args=""
# shellcheck disable=SC2044  # config paths are controlled and contain no spaces
for f in $(find config -type f -name '*.ts' ! -name '*.example.ts'); do
  args="$args -c $f"
done

# Basic auth for webproc's editor. The surface is kept local-only at the host
# (compose publishes 127.0.0.1:8080:8080), with auth as a second layer. webproc
# itself must bind 0.0.0.0 *inside* the container so Docker's port publish can
# forward to it.
#
# Basic auth is mandatory (ADR-0010): webproc's editor can write any config
# file and restart the process, so refuse to start it unauthenticated. Creds
# are injected via env (never baked into the image); compose supplies
# overridable defaults.
if [ -z "$WEBPROC_USER" ] || [ -z "$WEBPROC_PASS" ]; then
  echo "entrypoint: WEBPROC_USER and WEBPROC_PASS must both be set — the webproc editor requires basic auth" >&2
  exit 1
fi
auth="--user $WEBPROC_USER --pass $WEBPROC_PASS"

# --on-save restart : a save bounces Deno; the new config is read on boot.
# --on-exit ignore  : a bad edit crashes the boot; webproc surfaces the log for
#                     in-place repair instead of crash-looping.
# shellcheck disable=SC2086  # word-splitting on $args/$auth is intentional
exec webproc \
  $args \
  --on-save restart \
  --on-exit ignore \
  --host 0.0.0.0 \
  --port 8080 \
  $auth \
  -- deno run --allow-all src/main.ts
