#!/bin/bash
# Git-based sync for the knowledge layer: auto-memory, rules, and any extra
# knowledge dirs. Git is the conflict-resolution engine — rebase pulls, plain
# merge conflicts surface as normal conflict markers for the agent to resolve.
#
# Usage:
#   sync.sh init <remote-url>   # one-time: repo over ~/.claude knowledge surfaces
#   sync.sh status              # what would sync
#   sync.sh sync                # commit local changes, pull --rebase, push
#
# Extra dirs (e.g. OKF bundles) that already live in their own git repos are
# NOT touched — sync those with their own git remotes.
set -euo pipefail

KDIR="$HOME/.claude"
PATHS=()
for p in rules CLAUDE.md; do [ -e "$KDIR/$p" ] && PATHS+=("$p"); done
# every project's auto-memory dir, relative to ~/.claude
while IFS= read -r d; do PATHS+=("${d#"$KDIR"/}"); done \
  < <(find "$KDIR/projects" -maxdepth 2 -type d -name memory 2>/dev/null)

g() { git -C "$KDIR" "$@"; }

case "${1:-}" in
init)
    [ -n "${2:-}" ] || { echo "usage: sync.sh init <remote-url>"; exit 1; }
    if [ -e "$KDIR/.git" ] || [ -e "$KDIR/.gitignore" ]; then
        echo "refusing to init: $KDIR/.git or $KDIR/.gitignore already exists and init would overwrite the .gitignore. Merge by hand or remove them first." >&2
        exit 1
    fi
    g init -b main
    g remote get-url origin >/dev/null 2>&1 || g remote add origin "$2"
    # knowledge surfaces only — everything else in ~/.claude stays out
    printf '%s\n' '*' '!.gitignore' '!rules' '!rules/**' '!CLAUDE.md' \
        '!projects' '!projects/*' '!projects/*/memory' '!projects/*/memory/**' \
        > "$KDIR/.gitignore"
    g add .gitignore "${PATHS[@]}" 2>/dev/null || true
    g commit -m "knowledge-sync: initial snapshot" >/dev/null 2>&1 || true
    echo "initialized; run: sync.sh sync"
    ;;
status)
    g status --short -- .gitignore "${PATHS[@]}" 2>/dev/null || echo "not initialized (run: sync.sh init <remote-url>)"
    ;;
sync)
    g add -A -- .gitignore "${PATHS[@]}" 2>/dev/null
    g diff --cached --quiet || g commit -m "knowledge-sync: $(hostname -s) $(date +%Y-%m-%d)" >/dev/null
    ! g ls-remote --exit-code origin main >/dev/null 2>&1 || g pull --rebase origin main || {
        echo "CONFLICT: resolve markers in the files above, then: git -C ~/.claude rebase --continue && sync.sh sync"; exit 1; }
    g push -u origin main
    echo "synced"
    ;;
*)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
