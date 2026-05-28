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
fi
