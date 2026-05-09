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

# Bundled example template, kept apart from the runtime template dir. The Deno seeder
# (src/template/loader.ts) copies this into TEMPLATE_DIR only when TEMPLATE_DIR is empty,
# so a populated bind-mount is never overwritten.
COPY templates/example/ /app/template-seed/

ENV TEMPLATE_DIR=/app/template
ENV TEMPLATE_SEED_DIR=/app/template-seed

EXPOSE 3000

CMD ["deno", "run", "--allow-all", "src/main.ts"]
