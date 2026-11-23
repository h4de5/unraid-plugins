#!/usr/bin/env bash
set -euo pipefail

echo "Updating yt-dlp..."
TMP="/tmp/.yt-dlp.tmp.$$"
curl -fL -o "${TMP}" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"
chmod +x "${TMP}"
"${TMP}" --version >/dev/null
mv -f "${TMP}" /usr/local/bin/yt-dlp
echo "yt-dlp: $(/usr/local/bin/yt-dlp --version)"

echo "Updating node (JS runtime) is not needed (base image)."
echo "Updating ffmpeg is not needed (base image)."
echo "Done."
