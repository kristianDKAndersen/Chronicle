#!/usr/bin/env bash
# chronicle-write.test.sh — bash TDD harness for chronicle-write dispatcher + scripts.
# Tests: session-id roundtrip, first-run-init 8 subdirs,
#        stop-session AUTO_WRITE=false, lesson-candidate LESSON_ON_FAILURE=false.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$REPO_ROOT/bin/chronicle-write"

pass_count=0
fail_count=0

# ── assertion helpers ───────────────────────────────────────────────────────
assert_matches() {
  local label="$1" actual="$2" pattern="$3"
  if echo "$actual" | grep -qE "$pattern"; then
    echo "PASS: $label"
    ((pass_count++))
  else
    echo "FAIL: $label"
    echo "  pattern: $pattern"
    echo "  actual:  $actual"
    ((fail_count++))
  fi
}

assert_dir_exists() {
  local label="$1" dir="$2"
  if [[ -d "$dir" ]]; then
    echo "PASS: $label"
    ((pass_count++))
  else
    echo "FAIL: $label — directory not found: $dir"
    ((fail_count++))
  fi
}

assert_file_exists() {
  local label="$1" file="$2"
  if [[ -f "$file" ]]; then
    echo "PASS: $label"
    ((pass_count++))
  else
    echo "FAIL: $label — file not found: $file"
    ((fail_count++))
  fi
}

assert_file_not_exists() {
  local label="$1" file="$2"
  if [[ ! -f "$file" ]]; then
    echo "PASS: $label"
    ((pass_count++))
  else
    echo "FAIL: $label — file should not exist: $file"
    ((fail_count++))
  fi
}

assert_empty_dir() {
  local label="$1" dir="$2"
  local count
  count=$(find "$dir" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$count" -eq 0 ]]; then
    echo "PASS: $label"
    ((pass_count++))
  else
    echo "FAIL: $label — expected 0 .md files, found $count"
    ((fail_count++))
  fi
}

# ── test environment ────────────────────────────────────────────────────────
TMPDIR_BASE=$(mktemp -d /tmp/chronicle-test-XXXXXX)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

export CLAUDE_PLUGIN_DATA="$TMPDIR_BASE"
export CHRONICLE_PROJECT_SLUG="test-project"
# Redirect vault root to temp dir so bun writes don't touch ~/.claude/vault
export CHRONICLE_VAULT="$TMPDIR_BASE/vault"

echo "=== TEST 1: first-run-init creates 8 subdirs ==="
bash "$REPO_ROOT/scripts/first-run-init.sh"
for subdir in sessions synthesis lessons decisions reminders references checkpoints constraints; do
  assert_dir_exists "first-run-init: creates $subdir/" "$TMPDIR_BASE/test-project/$subdir"
done
assert_file_exists "first-run-init: writes initialized sentinel" "$TMPDIR_BASE/test-project/initialized"

echo ""
echo "=== TEST 2: session-id roundtrip ==="
SESSION_FILE="$TMPDIR_BASE/test-project/current-session-id"
"$BINARY" session-start
assert_file_exists "session-start: creates current-session-id" "$SESSION_FILE"
SESSION_ID=$(cat "$SESSION_FILE")
assert_matches "session-id: format <ts>-<8hex>" "$SESSION_ID" '^[0-9]+-[0-9a-f]{8}$'

echo ""
echo "=== TEST 3: stop-session with AUTO_WRITE_ON_STOP=false writes nothing ==="
export CHRONICLE_PLUGIN_OPTION_AUTO_WRITE_ON_STOP="false"
# session-id file must exist for stop-session to read
[[ -f "$SESSION_FILE" ]] || "$BINARY" session-start
"$BINARY" stop-session
assert_file_not_exists "stop-session: deletes current-session-id" "$SESSION_FILE"
assert_empty_dir "stop-session: no .md files written (AUTO_WRITE=false)" "$TMPDIR_BASE/test-project/sessions"

echo ""
echo "=== TEST 4: lesson-candidate with LESSON_ON_FAILURE=false writes nothing ==="
export CHRONICLE_PLUGIN_OPTION_LESSON_ON_FAILURE="false"
"$BINARY" lesson-candidate
assert_empty_dir "lesson-candidate: no .md files written (LESSON_ON_FAILURE=false)" "$TMPDIR_BASE/test-project/lessons"

echo ""
echo "=== Results ==="
echo "Passed: $pass_count"
echo "Failed: $fail_count"
if [[ $fail_count -gt 0 ]]; then
  exit 1
fi
echo "All tests passed."
