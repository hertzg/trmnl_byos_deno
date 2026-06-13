# syntax=docker/dockerfile:1.7
#
# Multi-arch image for the Pi 5 (arm64) and amd64. Arch-agnostic — TARGETARCH is
# populated by BuildKit from the build platform, so no --platform is pinned here:
#   on the Pi:   docker build -t trmnl-byos .
#   from a Mac:  docker buildx build --platform linux/arm64 -t trmnl-byos .
#
# The Deno server is supervised by jpillora/webproc (ADR-0010), which serves a
# browser editor for the mounted config/ files on :8080 and restarts Deno on save.
#
# Pinned to the version dev/CI runs (2.8.0). The dither pipeline imports the wasm
# kernel via a raw import (`unstable: ["raw-imports"]` in deno.jsonc); older Deno
# (e.g. 2.1.4) doesn't know that flag — it warns "'raw-imports' isn't a valid
# unstable feature" and the import fails to load, crashing the boot with exit 1.
FROM denoland/deno:debian-2.8.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/*

# webproc supervisor — install the published release binary for the target arch
# (arm64/amd64), verified against the release checksums. TARGETARCH is set by
# BuildKit (arm64 on a native Pi build; selected by --platform on a cross-build).
ARG TARGETARCH
ARG WEBPROC_VERSION=0.4.0
RUN set -eux; \
    base="https://github.com/jpillora/webproc/releases/download/v${WEBPROC_VERSION}"; \
    asset="webproc_${WEBPROC_VERSION}_linux_${TARGETARCH}.gz"; \
    wget -q "${base}/${asset}"; \
    wget -q "${base}/webproc_${WEBPROC_VERSION}_checksums.txt"; \
    grep " ${asset}\$" "webproc_${WEBPROC_VERSION}_checksums.txt" | sha256sum -c -; \
    gunzip "${asset}"; \
    install -m 0755 "webproc_${WEBPROC_VERSION}_linux_${TARGETARCH}" /usr/local/bin/webproc; \
    rm -f "webproc_${WEBPROC_VERSION}_checksums.txt" "webproc_${WEBPROC_VERSION}_linux_${TARGETARCH}"

ENV DENO_DIR=/deno-dir

WORKDIR /app

# Cache deps separately for faster rebuilds. main.ts statically imports
# ../config/system.ts (the live, gitignored file); provide it transiently from
# the example so `deno cache` resolves, then remove it in the same layer — no
# live config (and no baked default) lands in the image. Config is mounted at
# runtime.
COPY deno.jsonc ./
COPY config/ ./config/
COPY src/ ./src/
RUN cp config/system.example.ts config/system.ts \
    && deno cache src/main.ts \
    && rm config/system.ts

# Bundled Plugin + DesignSystem, served directly from PLUGIN_DIR's default
# (./templates/example, resolved against WORKDIR).
COPY templates/ ./templates/

# Entrypoint supervises Deno with webproc and globs config/ into -c flags.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# :3000 app/dashboard (public); :8080 webproc editor (local-only + basic auth).
EXPOSE 3000
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
