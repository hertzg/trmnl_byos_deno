# syntax=docker/dockerfile:1-labs
#
# Multi-arch image for the Pi 5 (arm64) and amd64. Arch-agnostic — TARGETARCH is
# populated by BuildKit from the build platform, so no --platform is pinned here:
#   on the Pi:   docker build -t trmnl-byos .
#   from a Mac:  docker buildx build --platform linux/arm64 -t trmnl-byos .
#
# The Deno server is supervised by jpillora/webproc (ADR-0010), which serves a
# browser editor for the mounted config/live/ files on :8080 and restarts Deno on save.
#
# Unversioned :debian tag — tracks the latest Deno. The base must be recent
# enough for the DesignSystem's `with { type: "text" }` CSS imports
# (ds/styles/Styles.tsx), which were unstable-flagged until Deno stabilized
# raw text/bytes imports, and for the wasm-module import in the dither
# pipeline (stable since 2.1). Latest satisfies both; a pinned 2.1.4 once
# crash-looped here — see git history.
FROM denoland/deno:debian

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

# Dependency layer: copy manifest files only so this layer is cache-stable
# across source edits. The --parents glob (needs the 1-labs syntax frontend
# above) picks up every member deno.jsonc at its own path, so adding a plugin
# or moving a member never touches this file — the workspace root's
# "./plugins/*" glob and this COPY discover members the same way.
# deno.lock ships into the image (ADR-0012) so the build is reproducible;
# --frozen enforces it: if the lock predates a new import the build fails
# loud rather than resolving silently.
COPY deno.jsonc deno.lock ./
COPY --parents ./*/deno.jsonc ./*/*/deno.jsonc ./
RUN deno install --frozen

# Source layer: copy all workspace members (config/live/ is dockerignored).
COPY server/ ./server/
COPY ds/ ./ds/
COPY plugins/ ./plugins/
COPY config/ ./config/

# Seed build-time live config so the module graph resolves for `deno cache`.
# These files are never mounted and exist only during the build layer.
RUN mkdir -p config/live/plugins/transport config/live/plugins/gallery config/live/plugins/home \
    && cp config/system.example.ts config/live/system.ts \
    && cp config/plugins/transport/routes.example.ts config/live/plugins/transport/routes.ts \
    && cp config/plugins/gallery/album.example.ts config/live/plugins/gallery/album.ts \
    && cp config/plugins/home/sleep.example.ts config/live/plugins/home/sleep.ts

# Cache the full graph from the workspace entrypoint. With config/system.ts
# statically importing @hztrmnl/home → @hztrmnl/transport → hafas-client, a
# single cache invocation covers what previously needed an extra hand-maintained
# line for journey_client.ts (ADR-0012 deletes that line).
RUN deno cache --frozen server/src/main.ts

# Entrypoint supervises Deno with webproc and globs config/live/ into -c flags.
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# :3000 app/dashboard (public); :8080 webproc editor (local-only + basic auth).
EXPOSE 3000
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Build identity for the dashboard (server/src/build-info.ts): CI injects the
# UTC build instant, baked into a static build-info.json — no runtime env
# vars, no writes to the checkout. A local build without --build-arg reads as
# "<version>+dev". Deliberately the LAST instructions: BUILD_DATE changes on
# every CI build, and everything after an ARG's declaration re-runs when its
# value changes — kept here, only this one printf layer is ever invalidated.
ARG BUILD_DATE=
RUN printf '{"date":"%s"}\n' "${BUILD_DATE}" > build-info.json
