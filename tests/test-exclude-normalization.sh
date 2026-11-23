#!/bin/bash
# Unit test for scripts/normalize-excludes.sh.
#
# Verifies the 7-Zip exclude-pattern normalisation: patterns are turned into
# -xr! arguments that match at any archive depth, and invalid input is dropped.
# No 7-Zip binary is required - this tests the pure string transformation.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB="$ROOT/src/usr/local/emhttp/plugins/unraid-unzip/scripts/normalize-excludes.sh"

[[ -f "$LIB" ]] || { echo "FAIL: lib not found: $LIB" >&2; exit 1; }
# shellcheck source=/dev/null
source "$LIB"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# run <pattern> -> prints the normalised -xr! argument
run() { printf '%s\n' "$1" | normalize_excludes; }

# 1. bare name -> wildcarded
[[ "$(run "a.txt")" == "-xr!*a.txt" ]] || fail "bare name: got '$(run "a.txt")'"
pass "bare name -> -xr!*a.txt"

# 2. bare directory -> wildcarded
[[ "$(run "node_modules")" == "-xr!*node_modules" ]] || fail "bare dir"
pass "bare dir -> -xr!*node_modules"

# 3. single-segment + /* stays as-is (already wildcard-free prefix, gets prefix)
#    "Sample/*" does not start with * ? [ -> prefixed -> *Sample/*
[[ "$(run "Sample/*")" == "-xr!*Sample/*" ]] || fail "Sample/* : got '$(run "Sample/*")'"
pass "Sample/* -> -xr!*Sample/*"

# 4. multi-segment fixed path gets a leading wildcard
[[ "$(run "Deep/Sample/*")" == "-xr!*Deep/Sample/*" ]] || fail "Deep/Sample/* : got '$(run "Deep/Sample/*")'"
pass "Deep/Sample/* -> -xr!*Deep/Sample/*"

# 5. already-wildcard patterns are not double-prefixed
[[ "$(run "*.log")" == "-xr!*.log" ]] || fail "*.log : got '$(run "*.log")'"
pass "already-wildcard *.log unchanged"

# 6. ? prefix recognised as a wildcard
[[ "$(run "?tmp")" == "-xr!?tmp" ]] || fail "?tmp : got '$(run "?tmp")'"
pass "?tmp unchanged"

# 7. [ prefix recognised as a wildcard
[[ "$(run "[a-z]*")" == "-xr![a-z]*" ]] || fail "[a-z]* : got '$(run "[a-z]*")'"
pass "[a-z]* unchanged"

# 8. blank lines are dropped
out="$(printf '\n\n' | normalize_excludes)"
[[ -z "$out" ]] || fail "blank lines should be dropped, got '$out'"
pass "blank lines dropped"

# 9. multiple lines -> one argument each, order preserved
out="$(printf 'a.txt\nnode_modules\n' | normalize_excludes)"
expected=$'-xr!*a.txt\n-xr!*node_modules'
[[ "$out" == "$expected" ]] || fail "multi-line: got '$out'"
pass "multiple lines preserved in order"

echo "All exclude-normalization tests passed."
