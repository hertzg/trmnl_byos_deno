# syntax=docker/dockerfile:1.7
FROM denoland/deno:alpine-2.1.4

# Astral needs a real chromium binary
RUN apk add --no-cache \
      chromium \
      ttf-freefont \
      font-noto-emoji \
      ca-certificates \
    && rm -rf /var/cache/apk/*

ENV ASTRAL_BIN=/usr/bin/chromium-browser
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
     "src/main.ts"]
