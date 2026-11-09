#!/bin/bash
# Verify the pinned 7-Zip SHA256 is still resolvable at its official URL.
#
# Catches the case where the pinned version (26.05) is removed from the upstream
# release host and would break fresh installs. Runs in CI; a local copy of the
# tarball is used if the network is unavailable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA256="22cf82fcc6eb7474f1d5bb4f02c0f8ebd573a718089d6833dc30f8350a3b232e"
URL="https://github.com/ip7z/7zip/releases/download/26.05/7z2605-linux-x64.tar.xz"
LOCAL="$ROOT/packages/7z2605-linux-x64.tar.xz"

# Prefer a local copy (fast, no network). Fall back to the URL.
if [[ -f "$LOCAL" ]]; then
  echo "using local copy: $LOCAL"
  actual="$(sha256sum "$LOCAL" | awk '{print $1}')"
else
  echo "downloading: $URL"
  tmp="$(mktemp -t 7z-check.XXXXXX)"
  curl -fsSL --max-time 120 "$URL" -o "$tmp"
  actual="$(sha256sum "$tmp" | awk '{print $1}')"
  rm -f "$tmp"
fi

echo "expected: $SHA256"
echo "actual  : $actual"

if [[ "$actual" == "$SHA256" ]]; then
  echo "PASS: 7-Zip checksum verified"
else
  echo "FAIL: 7-Zip checksum mismatch (pinned version may have been removed upstream)" >&2
  exit 1
fi
