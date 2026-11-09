#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MERGE="$ROOT/src/usr/local/emhttp/plugins/unraid-unzip/scripts/merge-tree.sh"
TMP="$(mktemp -d /tmp/unraid-unzip-tests.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# 1. overwrite policy replaces existing file
src="$TMP/ow-src"; dst="$TMP/ow-dst"; rm -rf "$src" "$dst"; mkdir -p "$src" "$dst"
printf 'new' > "$src/file.txt"; printf 'old' > "$dst/file.txt"
"$MERGE" "$src" "$dst" overwrite 99 100 >/dev/null 2>&1 || fail "overwrite merge rc"
[[ "$(cat "$dst/file.txt")" == "new" ]] || fail "overwrite content"
[[ ! -e "$src/file.txt" ]] || fail "source not moved"
pass "overwrite"

# 2. skip policy keeps existing file and removes source
src="$TMP/sk-src"; dst="$TMP/sk-dst"; rm -rf "$src" "$dst"; mkdir -p "$src" "$dst"
printf 'new' > "$src/file.txt"; printf 'old' > "$dst/file.txt"
"$MERGE" "$src" "$dst" skip 99 100 >/dev/null 2>&1 || fail "skip merge rc"
[[ "$(cat "$dst/file.txt")" == "old" ]] || fail "skip content"
[[ ! -e "$src/file.txt" ]] || fail "skip source not removed"
pass "skip"

# 3. rename_existing preserves old file
src="$TMP/re-src"; dst="$TMP/re-dst"; rm -rf "$src" "$dst"; mkdir -p "$src" "$dst"
printf 'new' > "$src/file.txt"; printf 'old' > "$dst/file.txt"
"$MERGE" "$src" "$dst" rename_existing 99 100 >/dev/null 2>&1 || fail "rename_existing rc"
[[ "$(cat "$dst/file.txt")" == "new" ]] || fail "rename_existing new content"
old_count="$(find "$dst" -maxdepth 1 -name 'file.txt.unraid-unzip-old-*' | wc -l)"
[[ "$old_count" -eq 1 ]] || fail "rename_existing old file count"
pass "rename_existing"

# 4. rename_new keeps existing file and moves source under a new name
src="$TMP/rn-src"; dst="$TMP/rn-dst"; rm -rf "$src" "$dst"; mkdir -p "$src" "$dst"
printf 'new' > "$src/file.txt"; printf 'old' > "$dst/file.txt"
"$MERGE" "$src" "$dst" rename_new 99 100 >/dev/null 2>&1 || fail "rename_new rc"
[[ "$(cat "$dst/file.txt")" == "old" ]] || fail "rename_new existing content"
new_count="$(find "$dst" -maxdepth 1 -name 'file.txt.unraid-unzip-new-*' | wc -l)"
[[ "$new_count" -eq 1 ]] || fail "rename_new new file count"
pass "rename_new"

# 5. directory merge is recursive
src="$TMP/dir-src"; dst="$TMP/dir-dst"; rm -rf "$src" "$dst"; mkdir -p "$src/sub" "$dst/sub"
printf 'a' > "$src/sub/a.txt"; printf 'b' > "$dst/sub/b.txt"
"$MERGE" "$src" "$dst" overwrite 99 100 >/dev/null 2>&1 || fail "directory merge rc"
[[ -f "$dst/sub/a.txt" && -f "$dst/sub/b.txt" ]] || fail "directory merge files"
pass "directory merge"

# 6. type conflict returns 3
src="$TMP/tc-src"; dst="$TMP/tc-dst"; rm -rf "$src" "$dst"; mkdir -p "$src" "$dst"
printf 'x' > "$src/name"; mkdir -p "$dst/name"
set +e
"$MERGE" "$src" "$dst" overwrite 99 100 >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -eq 3 ]] || fail "type conflict rc=$rc"
pass "type conflict"

echo "All tests passed."
