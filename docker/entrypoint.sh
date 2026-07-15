#!/bin/sh
# Container entrypoint (ADR-0010, ADR-0012): supervise the Deno server with
# webproc and auto-discover the editable config so the -c list never needs
# hand-maintenance as plugins are added.
#
# webproc's -c takes individual file paths only (no dir, no glob), so we glob
# them ourselves at container start: every *.ts under config/live/. A newly
# added config file becomes editable after the next restart (adding a plugin is
# a deploy) — acceptable per the ADR.
set -e

# Seed each config/live/<name>.ts from the baked config/**/<name>.example.ts
# starter when the live file is missing, so a fresh mount materializes real,
# editable config and webproc lists it on first boot instead of an empty editor.
# An already-edited live file is never clobbered.
# Only starters outside config/live/ are considered (prune the live tree itself).
# shellcheck disable=SC2044  # config paths are controlled and contain no spaces
for ex in $(find config -path config/live -prune -o -type f -name '*.example.ts' -print); do
  # Map config/<rel>.example.ts → config/live/<rel>.ts
  rel="${ex#config/}"
  live="config/live/${rel%.example.ts}.ts"
  mkdir -p "$(dirname "$live")"
  [ -e "$live" ] || { cp "$ex" "$live"; echo "entrypoint: seeded $live from $ex" >&2; }
done

args=""
# shellcheck disable=SC2044  # config paths are controlled and contain no spaces
for f in $(find config/live -type f -name '*.ts' ! -name '*.example.ts'); do
  args="$args -c $f"
done

# Basic auth for webproc's editor — optional. The surface is kept local-only at
# the host (compose publishes 127.0.0.1:8080:8080); auth is a second layer added
# only when both creds are present (compose supplies overridable defaults). Creds
# are injected via env, never baked into the image. webproc itself must bind
# 0.0.0.0 *inside* the container so Docker's port publish can forward to it.
auth=""
if [ -n "$WEBPROC_USER" ] && [ -n "$WEBPROC_PASS" ]; then
  auth="--user $WEBPROC_USER --pass $WEBPROC_PASS"
fi

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
  -- deno run --allow-all server/src/main.ts
