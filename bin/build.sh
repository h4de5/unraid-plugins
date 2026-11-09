#!/usr/bin/env bash
# Build the unraid-unzip plugin package (.txz) from src/.
#
# This is the public, CI-friendly build script. It lints the sources and
# produces a deterministic .txz (fixed mtime/owner/member order), so the SHA256
# is reproducible across machines: a local build and the CI release build hash
# identically. It does NOT install anything on a host and has no network or SSH
# dependencies.
#
# The 7-Zip runtime dependency (7zzs) is NOT bundled into the package. The
# installer downloads a pinned ip7z/7zip build and verifies its SHA256 before
# use. The pin lives in bin/generate-pages.sh (single source of truth), which
# generates the install manifest that carries the download URL + checksum.
#
# bin/build.sh --version 2026.11.08.03 --out-dir packages
#
# Output (parseable by CI):
#   PKG_NAME=unraid-unzip-2026.11.08.03-noarch-1.txz
#   PKG_PATH=<absolute path>
#   PKG_SHA256=<hex>
#
# NOTE: this script does NOT touch the install manifest (unraid-unzip.plg).
# That file is a build artifact generated AFTER this build, so it can carry the
# SHA of the exact .txz. See bin/generate-pages.sh.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/src/usr/local/emhttp/plugins/unraid-unzip"

VERSION="" OUT_DIR="$REPO/packages"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)  VERSION="$2"; shift 2 ;;
    --out-dir)  OUT_DIR="$2"; shift 2 ;;
    -h|--help)  grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$VERSION" ]] || { echo "--version is required" >&2; exit 2; }

PKG_NAME="unraid-unzip-${VERSION}-noarch-1.txz"

step() { printf '\n==> %s\n' "$*"; }

step "Lint (syntax only)"
bash -n "$SRC/scripts/job-runner.sh"
bash -n "$SRC/scripts/merge-tree.sh"
bash -n "$SRC/scripts/normalize-excludes.sh"
node --check "$SRC/js/unraid-unzip.js"
# PHP lint is enforced wherever php is present (CI installs it); warn-only if
# the local toolchain has no php so the build is not blocked on a dev machine.
if command -v php >/dev/null 2>&1; then
  php -l "$SRC/include/api.php"
  php -l "$SRC/include/lib.php"
  php -l "$SRC/scripts/job-helper.php"
else
  echo "warn: php not found; skipping php -l (CI enforces it)" >&2
fi
echo "lint: OK"

step "Build $PKG_NAME"
mkdir -p "$OUT_DIR"
rm -rf /tmp/uuz-build
mkdir -p /tmp/uuz-build
cp -r "$REPO/src/usr" /tmp/uuz-build/
cp -r "$REPO/src/install" /tmp/uuz-build/
cat > /tmp/uuz-build/.PKGINFO <<EOF
#
# pkginfo - package information file
#
pkgname=unraid-unzip
arch=noarch
version=$VERSION
doinst=doinst.sh
desc="""unraid-unzip
Archive extraction for the unRAID File Manager (7z, zip, RAR, tar.gz, bz2, xz).
"""
EOF
# Deterministic archive so the SHA256 is reproducible across machines. GNU
# format (no pax headers), fixed mtime/owner, sorted members.
tar --format=gnu --sort=name --owner=0 --group=0 --numeric-owner --mtime=@0 \
    -cJf "$OUT_DIR/$PKG_NAME" -C /tmp/uuz-build .
rm -rf /tmp/uuz-build

PKG_PATH="$OUT_DIR/$PKG_NAME"
[[ -f "$PKG_PATH" ]] || { echo "FAIL: build did not produce $PKG_PATH" >&2; exit 1; }
PKG_SHA256="$(sha256sum "$PKG_PATH" | awk '{print $1}')"

step "Done"
echo "PKG_NAME=$PKG_NAME"
echo "PKG_PATH=$PKG_PATH"
echo "PKG_SHA256=$PKG_SHA256"
