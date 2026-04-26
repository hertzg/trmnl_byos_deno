# syntax=docker/dockerfile:1.7
#
# Note: using debian instead of alpine because Deno's alpine image bundles a
# libgcc_s.so.1 in /usr/local/lib that conflicts with Alpine's chromium.
FROM denoland/deno:debian-2.1.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        imagemagick \
        fonts-freefont-ttf \
        fonts-noto-color-emoji \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/*

ENV ASTRAL_BIN=/usr/bin/chromium
ENV DENO_DIR=/deno-dir

WORKDIR /app

# Cache deps separately for faster rebuilds
COPY deno.jsonc ./
COPY src/ ./src/
RUN deno cache src/main.ts

COPY templates/ ./templates/

EXPOSE 3000

CMD ["deno", "run", \
     "--allow-net", \
     "--allow-env", \
     "--allow-read", \
     "--allow-run", \
     "--allow-sys", \
     "src/main.ts"]
