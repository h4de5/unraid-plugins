#!/bin/sh
set -e

PUID="${PUID:-99}"
PGID="${PGID:-100}"

export HOME="/tmp"
cd /app

if [ "$(id -u)" = "0" ] && [ "$PUID" != "0" ]; then
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups node server.js
else
  exec node server.js
fi
