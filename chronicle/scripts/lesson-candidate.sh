#!/usr/bin/env bash
# lesson-candidate.sh — write a candidate lesson note on PostToolUseFailure.
# AD2: writes only to stderr (stdout reserved for Claude Code hook pipeline).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-options.sh
source "$SCRIPT_DIR/lib-options.sh"  # also exports CHRONICLE_VAULT / CHRONICLE_RESOLVED_SLUG

# Capture the PostToolUseFailure payload (failed tool call + error) from stdin.
HOOK_INPUT="$(cat || true)"

LESSON_ON_FAILURE="$(chronicle_opt lesson_on_failure true)"
SIG_MODE="$(chronicle_opt significance_mode hybrid)"

if [[ "$LESSON_ON_FAILURE" != "true" ]]; then
  echo "chronicle lesson-candidate: LESSON_ON_FAILURE=false, skipping" >&2
  exit 0
fi

if [[ "$SIG_MODE" == "explicit-only" ]]; then
  echo "chronicle lesson-candidate: significance_mode=explicit-only, skipping auto-capture" >&2
  exit 0
fi

SLUG="${CHRONICLE_RESOLVED_SLUG:-${CHRONICLE_PROJECT_SLUG:-$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")}}"
CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if ! command -v bun &>/dev/null; then
  echo "chronicle lesson-candidate: bun not found, skipping vault write" >&2
  exit 0
fi

CHRONICLE_HOOK_INPUT="$HOOK_INPUT" \
CHRONICLE_SLUG="$SLUG" \
CHRONICLE_CREATED_AT="$CREATED_AT" \
  bun "$SCRIPT_DIR/build-lesson-candidate.js" >&2 \
  || echo "chronicle lesson-candidate: vault write failed (bun error)" >&2
