#!/usr/bin/env bash
# stop-session.sh — write session note and clean up session ID on Stop hook.
# AD2: writes only to stderr (stdout reserved for Claude Code hook pipeline).
set -euo pipefail

SLUG="${CHRONICLE_PROJECT_SLUG:-$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")}"
DATA_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugin-data}"
SESSION_FILE="$DATA_DIR/$SLUG/current-session-id"
AUTO_WRITE="${CLAUDE_PLUGIN_OPTION_auto_write_on_stop:-true}"

if [[ ! -f "$SESSION_FILE" ]]; then
  echo "chronicle stop-session: no current-session-id found, skipping" >&2
  exit 0
fi

SESSION_ID=$(cat "$SESSION_FILE")
rm -f "$SESSION_FILE"

if [[ "$AUTO_WRITE" != "true" ]]; then
  echo "chronicle stop-session: AUTO_WRITE_ON_STOP=false, skipping vault write" >&2
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../lib/chronicle-vault.js"
NOTE_REL="sessions/${SESSION_ID}.md"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if command -v bun &>/dev/null; then
  bun --eval "
    import { writeNote } from '$LIB';
    writeNote('$NOTE_REL', {
      type: 'session',
      session_id: '$SESSION_ID',
      project: '$SLUG',
      agent: 'claude',
      created_at: '$CREATED_AT'
    }, '');
    process.stderr.write('chronicle: session note written: $NOTE_REL\n');
  " 2>&1 >&2 || echo "chronicle: vault write failed (bun error)" >&2
else
  echo "chronicle stop-session: bun not found, skipping vault write" >&2
fi
