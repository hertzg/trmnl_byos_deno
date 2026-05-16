# syntax=docker/dockerfile:1.7
FROM denoland/deno:debian-2.1.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/*

ENV DENO_DIR=/deno-dir

WORKDIR /app

# Cache deps separately for faster rebuilds
COPY deno.jsonc ./
COPY src/ ./src/
RUN deno cache src/main.ts

# Bundled example Plugin, kept apart from the runtime Plugin dir. The Deno
# seeder (src/plugin/loader.ts) copies this into PLUGIN_DIR only when
# PLUGIN_DIR is empty, so a populated bind-mount is never overwritten.
COPY templates/example/ /app/plugin-seed/

ENV PLUGIN_DIR=/app/plugin
ENV PLUGIN_SEED_DIR=/app/plugin-seed

EXPOSE 3000

CMD ["deno", "run", "--allow-all", "src/main.ts"]
