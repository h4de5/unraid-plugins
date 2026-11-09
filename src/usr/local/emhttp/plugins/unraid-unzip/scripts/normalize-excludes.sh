# 7-Zip anchors -xr! patterns to the start of the archive path, so a fixed
# leading path such as "Deep/Sample/*" misses "Root/Deep/Sample/*". A bare name
# or "Name/*" already matches at any depth, but a multi-segment path without a
# leading wildcard is root-anchored.
#
# normalize_excludes takes lines on stdin and prints one -xr! argument per line,
# prefixing a wildcard to any pattern that does not already start with one.
# Blank lines are skipped. Patterns containing NUL or a newline are dropped.
#
# Sourced by scripts/job-runner.sh; the function below is also unit-tested by
# tests/test-exclude-normalization.sh.

normalize_excludes() {
    local ex
    # `read -r` splits input on newlines, so each pattern is a single line; a
    # bash string cannot hold a NUL byte, so no further sanitising is possible
    # or needed here.
    while IFS= read -r ex; do
        if [[ -z "$ex" ]]; then
            continue
        fi
        case "${ex:0:1}" in
            '*'|'?'|'[') : ;;
            *) ex="*$ex" ;;
        esac
        printf -- '-xr!%s\n' "$ex"
    done
}
