#!/bin/bash
set -euo pipefail
umask 022

SRC="${1:-}"
DST="${2:-}"
POLICY="${3:-overwrite}"
OWNER_UID="${4:-99}"
OWNER_GID="${5:-100}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ -z "$SRC" || -z "$DST" || ! -d "$SRC" || ! -d "$DST" ]]; then
    echo "merge-tree: invalid source or destination" >&2
    exit 2
fi
if [[ ! "$OWNER_UID" =~ ^[0-9]+$ || ! "$OWNER_GID" =~ ^[0-9]+$ ]]; then
    echo "merge-tree: invalid owner" >&2
    exit 2
fi

unique_dest() {
    local base="$1"
    local candidate="$base"
    local n=1
    while [[ -e "$candidate" || -L "$candidate" ]]; do
        candidate="${base}-${n}"
        n=$((n + 1))
    done
    printf '%s' "$candidate"
}

entry_kind() {
    if [[ -d "$1" && ! -L "$1" ]]; then
        printf 'dir'
    else
        printf 'file'
    fi
}

move_entry() {
    local source="$1"
    local dest="$2"
    if mv -- "$source" "$dest" 2>/dev/null; then
        return 0
    fi
    if ! cp -a -- "$source" "$dest"; then
        echo "merge-tree: could not copy $source" >&2
        return 5
    fi
    rm -rf -- "$source"
}

merge_dir() {
    local source="$1"
    local dest="$2"
    local entry name target rc=0

    while IFS= read -r -d '' entry; do
        name="${entry##*/}"
        target="$dest/$name"
        merge_entry "$entry" "$target"
        rc=$?
        if (( rc != 0 )); then
            break
        fi
    done < <(find "$source" -mindepth 1 -maxdepth 1 -print0)

    if (( rc == 0 )); then
        rmdir -- "$source" 2>/dev/null || true
    fi
    return "$rc"
}

merge_entry() {
    local source="$1"
    local dest="$2"
    local source_kind dest_kind new_dest

    if [[ ! -e "$dest" && ! -L "$dest" ]]; then
        move_entry "$source" "$dest"
        return
    fi

    source_kind="$(entry_kind "$source")"
    dest_kind="$(entry_kind "$dest")"

    if [[ "$source_kind" == "dir" && "$dest_kind" == "dir" ]]; then
        merge_dir "$source" "$dest"
        return
    fi

    if [[ "$source_kind" != "$dest_kind" ]]; then
        echo "merge-tree: type conflict: $dest" >&2
        return 3
    fi

    case "$POLICY" in
        skip)
            rm -rf -- "$source"
            ;;
        overwrite)
            rm -rf -- "$dest"
            move_entry "$source" "$dest"
            ;;
        rename_existing)
            new_dest="$(unique_dest "${dest}.unraid-unzip-old-${STAMP}")"
            mv -- "$dest" "$new_dest"
            move_entry "$source" "$dest"
            ;;
        rename_new)
            new_dest="$(unique_dest "${dest}.unraid-unzip-new-${STAMP}")"
            move_entry "$source" "$new_dest"
            ;;
        ask)
            echo "merge-tree: unresolved overwrite policy for $dest" >&2
            return 4
            ;;
        *)
            echo "merge-tree: unknown overwrite policy: $POLICY" >&2
            return 2
            ;;
    esac
}

chown -hR "$OWNER_UID:$OWNER_GID" "$SRC" 2>/dev/null || true
merge_dir "$SRC" "$DST"
exit $?
