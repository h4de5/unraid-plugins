#!/bin/bash
set -Eeuo pipefail
umask 022

JOB_DIR="${1:-}"
if [[ -z "$JOB_DIR" || ! -d "$JOB_DIR" || ! -f "$JOB_DIR/job.env" ]]; then
    echo "job-runner: invalid job directory" >&2
    exit 64
fi

JOB_DIR="$(cd "$JOB_DIR" && pwd)"
cd /

set -a
# shellcheck disable=SC1090
. "$JOB_DIR/job.env"
set +a
rm -f -- "$JOB_DIR/job.env"

LOG="$JOB_DIR/output.log"
: > "$LOG"
chmod 600 "$LOG"

PHP_BIN="${PHP_BIN:-}"
if [[ ! -x "$PHP_BIN" ]]; then
    PHP_BIN="$(command -v php || true)"
fi
HELPER="${PLUGIN_DIR:-/usr/local/emhttp/plugins/unraid-unzip}/scripts/job-helper.php"
if [[ -z "$PHP_BIN" || ! -x "$PHP_BIN" || ! -f "$HELPER" ]]; then
    echo "job-runner: PHP helper not available" >> "$LOG"
    [[ -n "${LOCK_FILE:-}" ]] && rm -f -- "$LOCK_FILE"
    exit 70
fi

PGID="$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]' || true)"
[[ -n "$PGID" ]] || PGID="$$"
DONE=0

status() {
    local state="$1" phase="$2" message="$3" percent="${4:-}" code="${5:-}"
    UUZ_STATE="$state" UUZ_PHASE="$phase" UUZ_MESSAGE="$message" \
    UUZ_PERCENT="$percent" UUZ_EXIT="$code" UUZ_PID="$$" UUZ_PGID="$PGID" \
    UUZ_WARNINGS="${WARNINGS_JSON:-[]}" \
        "$PHP_BIN" -d auto_prepend_file= "$HELPER" status "$JOB_DIR" >> "$LOG" 2>&1 \
        || echo "job-runner: could not write status" >> "$LOG"
}

cleanup_staging() {
    [[ -n "${STAGING:-}" ]] || return 0
    case "$STAGING" in
        "${TARGET:-/nonexistent}"/.unraid-unzip.*)
            rm -rf -- "$STAGING" 2>/dev/null || true
            ;;
    esac
}

notify_done() {
    [[ "${NOTIFY_ON_COMPLETE:-yes}" == "yes" ]] || return 0
    local notify="/usr/local/emhttp/webGui/scripts/notify"
    [[ -x "$notify" ]] || return 0
    local title="Unraid Unzip"
    local message="$1"
    "$notify" -e unraid-unzip -s "$title" -d "$message" >/dev/null 2>&1 || true
}

finish() {
    local state="$1" code="$2" message="$3"
    DONE=1
    status "$state" "finished" "$message" 100 "$code"
    if [[ -n "${HISTORY_FILE:-}" ]]; then
        "$PHP_BIN" -d auto_prepend_file= "$HELPER" history "$JOB_DIR" "$HISTORY_FILE" "${HISTORY_LIMIT:-200}" >> "$LOG" 2>&1 \
            || echo "job-runner: could not append history" >> "$LOG"
    fi
    cleanup_staging
    [[ -n "${LOCK_FILE:-}" ]] && rm -f -- "$LOCK_FILE" || true
    notify_done "$message"
    if [[ "$state" == "done" ]]; then
        exit 0
    fi
    exit 2
}

fail() {
    local code="$1" message="$2"
    finish error "$code" "$message"
}

on_term() {
    trap - TERM INT HUP
    if [[ "$DONE" -eq 0 ]]; then
        finish cancelled 143 "Cancelled by user"
    fi
    exit 143
}

on_exit() {
    local rc=$?
    if [[ "$DONE" -eq 0 ]]; then
        finish error "$rc" "Job terminated unexpectedly (exit $rc)"
    fi
}

trap on_term TERM INT HUP
trap on_exit EXIT

allowed_path() {
    [[ "$1" == "/mnt" || "$1" == /mnt/* || "$1" == "/boot" || "$1" == /boot/* ]]
}

free_kb() {
    df -Pk "$1" 2>/dev/null | awk 'NR==2 {print $4}'
}

[[ -n "${JOB_ID:-}" && "$(basename "$JOB_DIR")" == "$JOB_ID" ]] || fail INTERNAL "Invalid job id"
[[ -n "${JOB_KIND:-}" ]] || fail INTERNAL "Missing job kind"
[[ -n "${SEVENZIP:-}" && -x "$SEVENZIP" ]] || fail INTERNAL "7-Zip binary is not executable"
[[ -n "${OWNER_UID:-}" && -n "${OWNER_GID:-}" ]] || fail INTERNAL "Missing ownership settings"
[[ -n "${TARGET:-}" ]] && allowed_path "$TARGET" || fail INVALID_PATH "Target is not under /mnt or /boot"

case "$JOB_KIND" in
    extract)
        [[ -n "${ARCHIVE:-}" && -f "$ARCHIVE" && -r "$ARCHIVE" ]] || fail NOT_FOUND "Archive not found"
        allowed_path "$ARCHIVE" || fail INVALID_PATH "Archive is not under /mnt or /boot"
        [[ -n "${STAGING:-}" ]] || fail INTERNAL "Missing staging directory"

        mkdir -p -- "$TARGET" || fail INTERNAL "Could not create target directory"
        [[ -d "$TARGET" && -w "$TARGET" ]] || fail INVALID_PATH "Target is not writable"
        case "$STAGING" in
            "$TARGET"/.unraid-unzip.*) ;;
            *) fail INVALID_PATH "Invalid staging directory" ;;
        esac
        if [[ -e "$STAGING" || -L "$STAGING" ]]; then
            rm -rf -- "$STAGING" || fail INTERNAL "Could not clear staging directory"
        fi
        mkdir -m 700 -- "$STAGING" || fail INTERNAL "Could not create staging directory"

        available_kb="$(free_kb "$TARGET" || true)"
        if [[ -n "$available_kb" && "$available_kb" =~ ^[0-9]+$ ]]; then
            needed=$(( ${TOTAL_BYTES:-0} + ${RESERVE_BYTES:-0} ))
            if (( needed > available_kb * 1024 )); then
                fail NO_SPACE "Not enough free space in the target filesystem"
            fi
        fi

        status running extracting "Extracting archive" 1

        declare -a exargs=()
        if declare -p EXCLUDES >/dev/null 2>&1; then
            normalize_lib="${PLUGIN_DIR:-/usr/local/emhttp/plugins/unraid-unzip}/scripts/normalize-excludes.sh"
            [[ -f "$normalize_lib" ]] || fail INTERNAL "Exclude normaliser is missing"
            # shellcheck source=/dev/null
            source "$normalize_lib"
            while IFS= read -r line; do
                [[ -n "$line" ]] && exargs+=( "$line" )
            done < <(printf '%s\n' "${EXCLUDES[@]}" | normalize_excludes)
        fi

        case "${TYPE:-}" in
            tar.gz|tar.bz2|tar.xz|tar.zst)
                declare -a outer=( "$SEVENZIP" x -y -so -- "$ARCHIVE" )
                declare -a inner=( "$SEVENZIP" x -si -ttar -y -aoa -bsp1 -bse2 -bb1 "-o$STAGING" )
                [[ "${PRESERVE_SYMLINKS:-yes}" == "yes" ]] && inner+=( -snl )
                inner+=( "${exargs[@]}" )
                set +e
                "${outer[@]}" </dev/null 2>> "$LOG" | "${inner[@]}" </dev/null >> "$LOG" 2>&1
                rc_outer=${PIPESTATUS[0]}
                rc_inner=${PIPESTATUS[1]}
                set -e
                rc="$rc_inner"
                (( rc_outer == 0 )) || rc="$rc_outer"
                ;;
            *)
                declare -a args=( "$SEVENZIP" x -y -aoa -bsp1 -bse2 -bb1 )
                [[ -n "${PASSWORD:-}" ]] && args+=( "-p$PASSWORD" )
                [[ "${PRESERVE_SYMLINKS:-yes}" == "yes" ]] && args+=( -snl )
                args+=( "-o$STAGING" "${exargs[@]}" -- "$ARCHIVE" )
                set +e
                "${args[@]}" </dev/null >> "$LOG" 2>&1
                rc=$?
                set -e
                ;;
        esac

        if (( rc != 0 && rc != 1 )); then
            fail "EXIT_$rc" "Extraction failed (7-Zip exit $rc)"
        fi

        # 7-Zip creates the directory tree even when every file beneath is
        # excluded; prune the resulting empty folders so they are not merged
        # into the target.
        find "$STAGING" -depth -type d -empty -delete 2>/dev/null || true

        merge_root="$STAGING"
        shopt -s nullglob dotglob
        entries=( "$STAGING"/* )
        shopt -u nullglob dotglob
        if [[ ${#entries[@]} -eq 1 && -d "${entries[0]}" && ! -L "${entries[0]}" ]]; then
            case "${STRIP_ROOT:-auto}" in
                auto|always) merge_root="${entries[0]}" ;;
            esac
        elif [[ "${STRIP_ROOT:-auto}" == "always" ]]; then
            fail STRIP_ROOT "Could not strip a single root folder"
        fi

        if ! chown -hR "$OWNER_UID:$OWNER_GID" "$merge_root" >> "$LOG" 2>&1; then
            echo "job-runner: ownership change failed" >> "$LOG"
        fi

        status running merging "Merging extracted files" 95
        merge_script="${PLUGIN_DIR:-/usr/local/emhttp/plugins/unraid-unzip}/scripts/merge-tree.sh"
        [[ -x "$merge_script" ]] || fail INTERNAL "Merge helper is not executable"
        set +e
        "$merge_script" "$merge_root" "$TARGET" "${OVERWRITE:-overwrite}" "$OWNER_UID" "$OWNER_GID" >> "$LOG" 2>&1
        merge_rc=$?
        set -e
        if (( merge_rc == 3 )); then
            fail TYPE_CONFLICT "A file and directory with the same name conflict"
        elif (( merge_rc != 0 )); then
            fail "EXIT_$merge_rc" "Merge failed (exit $merge_rc)"
        fi

        finish done 0 "Extraction complete"
        ;;

    *)
        fail INTERNAL "Unknown job kind"
        ;;
esac
