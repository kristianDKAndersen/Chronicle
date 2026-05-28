#!/usr/bin/env bash
# lesson-candidate.sh — write a candidate lesson note on PostToolUseFailure.
# AD2: writes only to stderr (stdout reserved for Claude Code hook pipeline).
set -euo pipefail

LESSON_ON_FAILURE="${CLAUDE_PLUGIN_OPTION_lesson_on_failure:-true}"
SIG_MODE="${CLAUDE_PLUGIN_OPTION_significance_mode:-hybrid}"

if [[ "$LESSON_ON_FAILURE" != "true" ]]; then
  echo "chronicle lesson-candidate: LESSON_ON_FAILURE=false, skipping" >&2
  exit 0
fi

if [[ "$SIG_MODE" == "explicit-only" ]]; then
  echo "chronicle lesson-candidate: significance_mode=explicit-only, skipping auto-capture" >&2
  exit 0
fi

SLUG="${CHRONICLE_PROJECT_SLUG:-$(basename "$PWD")}"
DATA_DIR="${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugin-data}"
SESSION_FILE="$DATA_DIR/$SLUG/current-session-id"
SESSION_ID=""
if [[ -f "$SESSION_FILE" ]]; then
  SESSION_ID=$(cat "$SESSION_FILE")
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../lib/chronicle-vault.js"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Use a timestamp-based filename to avoid collisions between concurrent failures
NOTE_REL="lessons/lesson-${CREATED_AT//[:TZ]/-}.md"

if command -v bun &>/dev/null; then
  bun --eval "
    import { writeNote } from '$LIB';
    writeNote('$NOTE_REL', {
      type: 'lesson',
      session_id: '${SESSION_ID:-unknown}',
      project: '$SLUG',
      agent: 'claude',
      created_at: '$CREATED_AT',
      status: 'candidate'
    }, 'Auto-captured lesson candidate from tool failure.');
    process.stderr.write('chronicle: lesson candidate written: $NOTE_REL\n');
  " 2>&1 >&2 || echo "chronicle: vault write failed (bun error)" >&2
else
  echo "chronicle lesson-candidate: bun not found, skipping vault write" >&2
fi
