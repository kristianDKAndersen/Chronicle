#!/usr/bin/env bash
# stop-session.sh — write a meaningful session note on the Stop hook.
# AD2: writes only to stderr (stdout reserved for Claude Code hook pipeline).
#
# Stop fires at the end of every assistant turn and provides a JSON payload on
# stdin ({ session_id, transcript_path, cwd, ... }). We drive the note off that
# payload — NOT a session-id tracker file — so the note is keyed by session_id,
# upserts on every Stop (one note per session, kept current), and never depends
# on session-start/stop slug agreement. lib-options.sh exports CHRONICLE_VAULT so
# the write lands in the same per-project vault the MCP server reads.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-options.sh
source "$SCRIPT_DIR/lib-options.sh"  # also exports CHRONICLE_VAULT / CHRONICLE_RESOLVED_SLUG

# Capture the Stop hook payload (best-effort; empty if none piped).
HOOK_INPUT="$(cat || true)"

AUTO_WRITE="$(chronicle_opt auto_write_on_stop true)"
if [[ "$AUTO_WRITE" != "true" ]]; then
  echo "chronicle stop-session: auto_write_on_stop=false, skipping vault write" >&2
  exit 0
fi

SLUG="${CHRONICLE_RESOLVED_SLUG:-${CHRONICLE_PROJECT_SLUG:-$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")}}"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! command -v bun &>/dev/null; then
  echo "chronicle stop-session: bun not found, skipping vault write" >&2
  exit 0
fi

CHRONICLE_HOOK_INPUT="$HOOK_INPUT" \
CHRONICLE_SLUG="$SLUG" \
CHRONICLE_CREATED_AT="$CREATED_AT" \
  bun "$SCRIPT_DIR/build-session-summary.js" >&2 \
  || echo "chronicle stop-session: vault write failed (bun error)" >&2
