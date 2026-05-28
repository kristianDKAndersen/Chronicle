#!/usr/bin/env bash
# check-due.sh — surface due notes at session start.
# AD2: may emit hook JSON to stdout when notes are due.
set -euo pipefail

SURFACE="${CHRONICLE_PLUGIN_OPTION_SURFACE_DUE_ON_START:-true}"

if [[ "$SURFACE" != "true" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../lib/chronicle-vault.js"

# Surface due notes within 3 days via vault lib
if command -v bun &>/dev/null; then
  bun --eval "
    import { listDue } from '$LIB';
    const today = new Date().toISOString().slice(0,10);
    const due = listDue(today, 3);
    if (due.length > 0) {
      const lines = due.map(n => '- ' + n.path + (n.due_date ? ' (due ' + n.due_date + ')' : '')).join('\n');
      process.stdout.write(JSON.stringify({type:'text',text:'Chronicle due notes:\n' + lines}) + '\n');
    }
  " 2>/dev/null || true

  # Count check — warn if vault exceeds configured threshold
  MAX_NOTES="${CHRONICLE_PLUGIN_OPTION_MAX_NOTES_BEFORE_PRUNE:-}"
  if [[ -n "$MAX_NOTES" ]]; then
    COUNT=$(bun --eval "import { countNotes } from '$LIB'; process.stdout.write(String(countNotes()));" 2>/dev/null || echo "0")
    if [[ "$COUNT" -gt "$MAX_NOTES" ]]; then
      echo "Your Chronicle vault has $COUNT notes. Run /chronicle:remember or /chronicle:due to review, or run 'chronicle-write prune' to archive old session notes."
    fi
  fi
fi
