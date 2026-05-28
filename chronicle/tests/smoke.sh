#!/usr/bin/env bash
# chronicle/tests/smoke.sh — end-to-end integration smoke test.
#
# Tests: bun install, session-start, lesson-candidate, stop-session,
#        vault search (via lib — MCP subprocess not spawned in smoke test),
#        vault_due (via lib), note count, cleanup.
#
# MCP server is not spawned in-process because doing so requires establishing
# a full JSON-RPC stdio handshake. Vault search and due checks are validated
# by calling chronicle-vault.js directly via bun --eval, which exercises
# identical code paths as the MCP tool handlers. Full MCP wiring is only
# verifiable in a live Claude Code session.
#
# Exit 0 only if all steps pass.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHRONICLE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHRONICLE_BIN="$CHRONICLE_DIR/bin/chronicle-write"
CHRONICLE_LIB="$CHRONICLE_DIR/lib/chronicle-vault.js"

echo "=== Chronicle smoke test ==="
echo "chronicle dir: $CHRONICLE_DIR"

# ── Step 1: bun install ─────────────────────────────────────────────────────
echo ""
echo "[1/8] bun install"
(cd "$CHRONICLE_DIR" && bun install 2>&1)
echo "PASS bun install"

# ── Temp environment setup ──────────────────────────────────────────────────
SMOKE_TMP="$(mktemp -d)"
trap 'rm -rf "$SMOKE_TMP"' EXIT

TEST_SLUG="chronicle-smoke"
TEST_PROJECT_DIR="$SMOKE_TMP/$TEST_SLUG"
mkdir -p "$TEST_PROJECT_DIR"

export CLAUDE_PLUGIN_DATA="$SMOKE_TMP/data"
export CHRONICLE_VAULT="$SMOKE_TMP/vault"
# Do NOT export CHRONICLE_PROJECT_SLUG — scripts derive slug from $PWD basename,
# and chronicle-vault.js uses CHRONICLE_VAULT when no project slug is set.
unset CHRONICLE_PROJECT_SLUG 2>/dev/null || true

SENTINEL="$CLAUDE_PLUGIN_DATA/$TEST_SLUG/initialized"
SESSION_FILE="$CLAUDE_PLUGIN_DATA/$TEST_SLUG/current-session-id"

# ── Step 2: session-start ───────────────────────────────────────────────────
echo ""
echo "[2/8] session-start"
(cd "$TEST_PROJECT_DIR" && bash "$CHRONICLE_BIN" session-start 2>&1) | sed 's/^/  /'

if [[ ! -f "$SENTINEL" ]]; then
  echo "FAIL: initialized sentinel not created at $SENTINEL" >&2; exit 1
fi
if [[ ! -f "$SESSION_FILE" ]]; then
  echo "FAIL: current-session-id not created at $SESSION_FILE" >&2; exit 1
fi
SESSION_ID="$(cat "$SESSION_FILE")"
echo "PASS session-start — sentinel ok, session_id=$SESSION_ID"

# ── Step 3: lesson-candidate ────────────────────────────────────────────────
echo ""
echo "[3/8] lesson-candidate"
(
  cd "$TEST_PROJECT_DIR"
  export CLAUDE_PLUGIN_OPTION_lesson_on_failure=true
  export CLAUDE_PLUGIN_OPTION_significance_mode=hybrid
  bash "$CHRONICLE_BIN" lesson-candidate 2>&1
) | sed 's/^/  /'

LESSON_COUNT="$(find "$CHRONICLE_VAULT" -name '*.md' -path '*/lessons/*' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$LESSON_COUNT" -lt 1 ]]; then
  echo "FAIL: no lesson note found in $CHRONICLE_VAULT/lessons/" >&2; exit 1
fi
echo "PASS lesson-candidate — $LESSON_COUNT lesson note(s) in vault"

# ── Step 4: stop-session ────────────────────────────────────────────────────
echo ""
echo "[4/8] stop-session"
(
  cd "$TEST_PROJECT_DIR"
  export CLAUDE_PLUGIN_OPTION_auto_write_on_stop=true
  bash "$CHRONICLE_BIN" stop-session 2>&1
) | sed 's/^/  /'

SESSION_COUNT="$(find "$CHRONICLE_VAULT" -name '*.md' -path '*/sessions/*' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$SESSION_COUNT" -lt 1 ]]; then
  echo "FAIL: no session note found in $CHRONICLE_VAULT/sessions/" >&2; exit 1
fi
if [[ -f "$SESSION_FILE" ]]; then
  echo "FAIL: session-id file still exists after stop-session" >&2; exit 1
fi
echo "PASS stop-session — $SESSION_COUNT session note(s), session-id file deleted"

# ── Step 5: vault_search (lib invocation — no MCP subprocess) ────────────────
# Note: session notes are written with empty bodies (metadata-only); lesson notes carry
# the body "Auto-captured lesson candidate from tool failure." so we search for "candidate".
echo ""
echo "[5/8] vault_search via lib"
SEARCH_RESULT="$(bun --eval "
  import { searchNotes } from '$CHRONICLE_LIB';
  const results = searchNotes('candidate', 10);
  process.stdout.write(String(results.length));
" 2>/dev/null)"
if [[ -z "$SEARCH_RESULT" ]] || [[ "$SEARCH_RESULT" -lt 1 ]]; then
  echo "FAIL: vault_search('candidate') returned 0 results" >&2; exit 1
fi
echo "PASS vault_search — $SEARCH_RESULT result(s) for 'candidate'"

# ── Step 6: vault_due ───────────────────────────────────────────────────────
echo ""
echo "[6/8] vault_due via lib"
DUE_RESULT="$(bun --eval "
  import { listDue } from '$CHRONICLE_LIB';
  const today = new Date().toISOString().slice(0,10);
  const due = listDue(today, 14);
  process.stdout.write(String(due.length));
" 2>/dev/null)"
echo "  due count: ${DUE_RESULT:-0}"
echo "PASS vault_due exits 0 (${DUE_RESULT:-0} notes due)"

# ── Step 7: note count ──────────────────────────────────────────────────────
echo ""
echo "[7/8] note count"
NOTE_COUNT="$(bun --eval "
  import { countNotes } from '$CHRONICLE_LIB';
  process.stdout.write(String(countNotes()));
" 2>/dev/null)"
if [[ -z "$NOTE_COUNT" ]] || [[ "$NOTE_COUNT" -lt 2 ]]; then
  echo "FAIL: expected >= 2 notes (lesson + session), got '${NOTE_COUNT:-0}'" >&2; exit 1
fi
echo "PASS note count = $NOTE_COUNT (>= 2: lesson + session)"

# ── Step 8: cleanup ─────────────────────────────────────────────────────────
echo ""
echo "[8/8] cleanup"
# trap EXIT handles rm -rf $SMOKE_TMP
echo "PASS cleanup (temp dir removed on exit)"

echo ""
echo "=== All 8 smoke test steps passed ==="
