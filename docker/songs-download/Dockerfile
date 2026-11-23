FROM node:22-bookworm-slim

ARG YT_DLP_VERSION=2026.10.26

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl util-linux \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fL -o /usr/local/bin/yt-dlp \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux" \
 && chmod +x /usr/local/bin/yt-dlp \
 && /usr/local/bin/yt-dlp --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=8765 \
    DOWNLOAD_DIR=/downloads \
    PUID=99 \
    PGID=100 \
    TZ=Europe/Berlin \
    STREAM_CACHE_TTL_MIN=60

EXPOSE 8765
VOLUME ["/downloads"]

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
