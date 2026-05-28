#!/usr/bin/env bash
# first-run-init.sh — create vault note-type subdirs and initialized sentinel on first run.
# AD2: writes nothing to stdout. Debug output → stderr only.
set -euo pipefail

SLUG="${CHRONICLE_PROJECT_SLUG:-$(basename "$PWD")}"
DATA_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugin-data}"
PROJECT_DIR="$DATA_DIR/$SLUG"
SENTINEL="$PROJECT_DIR/initialized"

if [[ -f "$SENTINEL" ]]; then
  exit 0
fi

mkdir -p "$PROJECT_DIR"

for subdir in sessions synthesis lessons decisions reminders references checkpoints constraints; do
  mkdir -p "$PROJECT_DIR/$subdir"
done

echo "initialized" > "$SENTINEL"
echo "chronicle: first-run-init complete for project '$SLUG'" >&2
