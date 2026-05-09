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

COPY templates/ ./templates/

# Default template ships at /app/templates/example. Override (or bind-mount your own dir
# and point this at it) to ship a different one.
ENV TEMPLATE_DIR=/app/templates/example

EXPOSE 3000

CMD ["deno", "run", "--allow-all", "src/main.ts"]
