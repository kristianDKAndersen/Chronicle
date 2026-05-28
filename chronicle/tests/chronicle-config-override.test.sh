#!/usr/bin/env bash
# chronicle-config-override.test.sh — TDD: project-level config takes precedence over env vars.
# Proves: (a) project file > env, (b) no project file -> env governs, (c) key absent in project -> env.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass_count=0
fail_count=0

assert_empty_dir() {
  local label="$1" dir="$2"
  local count
  count=$(find "$dir" -name "*.md" 2>/dev/null | wc -l | tr -d ' ') || true
  if [[ "$count" -eq 0 ]]; then
    echo "PASS: $label"
    ((++pass_count))
  else
    echo "FAIL: $label — expected 0 .md files, found $count in $dir"
    ((++fail_count))
  fi
}

assert_not_empty_dir() {
  local label="$1" dir="$2"
  local count
  count=$(find "$dir" -name "*.md" 2>/dev/null | wc -l | tr -d ' ') || true
  if [[ "$count" -gt 0 ]]; then
    echo "PASS: $label"
    ((++pass_count))
  else
    echo "FAIL: $label — expected >0 .md files, found 0 in $dir"
    ((++fail_count))
  fi
}

# ── test environment ────────────────────────────────────────────────────────
TMPDIR_BASE=$(mktemp -d /tmp/chronicle-override-test-XXXXXX)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# write_session_file DATA_DIR PROJ_DIR: creates the session-id file at the
# path stop-session.sh will look for it: $DATA_DIR/$(basename $PROJ_DIR)/current-session-id
write_session_file() {
  local data_dir="$1" proj_dir="$2"
  local slug
  slug="$(basename "$proj_dir")"
  mkdir -p "$data_dir/$slug"
  local sess_id
  sess_id="9999999999-$(openssl rand -hex 4 2>/dev/null || printf '%08x' $RANDOM)"
  echo "$sess_id" > "$data_dir/$slug/current-session-id"
}

# ── TEST (a): project file value WINS over env var ──────────────────────────
echo "=== TEST (a): project file auto_write_on_stop=false beats env=true ==="
DATA_A="$TMPDIR_BASE/data-a"
VAULT_A="$TMPDIR_BASE/vault-a"
PROJ_DIR_A="$TMPDIR_BASE/proj-a"
mkdir -p "$VAULT_A/sessions"
mkdir -p "$PROJ_DIR_A/.claude"
printf '{"auto_write_on_stop": false, "significance_mode": "hybrid"}' > "$PROJ_DIR_A/.claude/chronicle-config.json"
write_session_file "$DATA_A" "$PROJ_DIR_A"

env -u CHRONICLE_PROJECT_SLUG \
  CLAUDE_PLUGIN_DATA="$DATA_A" \
  CHRONICLE_VAULT="$VAULT_A" \
  CLAUDE_PROJECT_DIR="$PROJ_DIR_A" \
  CLAUDE_PLUGIN_OPTION_auto_write_on_stop="true" \
  bash "$REPO_ROOT/scripts/stop-session.sh" 2>&1 | grep -v '^$' || true

assert_empty_dir "project file false beats env true: no session note written" "$VAULT_A/sessions"

# ── TEST (b-1): no project file, env=false -> no note ───────────────────────
echo ""
echo "=== TEST (b-1): no project file, env=false -> no note ==="
DATA_B1="$TMPDIR_BASE/data-b1"
VAULT_B1="$TMPDIR_BASE/vault-b1"
PROJ_DIR_B1="$TMPDIR_BASE/proj-b1"  # no .claude/chronicle-config.json
mkdir -p "$VAULT_B1/sessions"
write_session_file "$DATA_B1" "$PROJ_DIR_B1"

env -u CHRONICLE_PROJECT_SLUG \
  CLAUDE_PLUGIN_DATA="$DATA_B1" \
  CHRONICLE_VAULT="$VAULT_B1" \
  CLAUDE_PROJECT_DIR="$PROJ_DIR_B1" \
  CLAUDE_PLUGIN_OPTION_auto_write_on_stop="false" \
  bash "$REPO_ROOT/scripts/stop-session.sh" 2>&1 | grep -v '^$' || true

assert_empty_dir "no project file + env false: no session note written" "$VAULT_B1/sessions"

# ── TEST (b-2): no project file, env unset -> default true -> writes ─────────
echo ""
echo "=== TEST (b-2): no project file, env unset -> default true -> writes ==="
DATA_B2="$TMPDIR_BASE/data-b2"
VAULT_B2="$TMPDIR_BASE/vault-b2"
PROJ_DIR_B2="$TMPDIR_BASE/proj-b2"  # no .claude/chronicle-config.json
mkdir -p "$VAULT_B2/sessions"
write_session_file "$DATA_B2" "$PROJ_DIR_B2"

env -u CHRONICLE_PROJECT_SLUG \
  -u CLAUDE_PLUGIN_OPTION_auto_write_on_stop \
  CLAUDE_PLUGIN_DATA="$DATA_B2" \
  CHRONICLE_VAULT="$VAULT_B2" \
  CLAUDE_PROJECT_DIR="$PROJ_DIR_B2" \
  bash "$REPO_ROOT/scripts/stop-session.sh" 2>&1 | grep -v '^$' || true

assert_not_empty_dir "no project file + env unset: session note written (default=true)" "$VAULT_B2/sessions"

# ── TEST (c): project file exists but key absent -> fall back to env ─────────
echo ""
echo "=== TEST (c): project file present, key absent -> env governs ==="
DATA_C="$TMPDIR_BASE/data-c"
VAULT_C="$TMPDIR_BASE/vault-c"
PROJ_DIR_C="$TMPDIR_BASE/proj-c"
mkdir -p "$VAULT_C/sessions"
mkdir -p "$PROJ_DIR_C/.claude"
# Project file has OTHER keys but NOT auto_write_on_stop
printf '{"significance_mode": "hybrid"}' > "$PROJ_DIR_C/.claude/chronicle-config.json"
write_session_file "$DATA_C" "$PROJ_DIR_C"

env -u CHRONICLE_PROJECT_SLUG \
  CLAUDE_PLUGIN_DATA="$DATA_C" \
  CHRONICLE_VAULT="$VAULT_C" \
  CLAUDE_PROJECT_DIR="$PROJ_DIR_C" \
  CLAUDE_PLUGIN_OPTION_auto_write_on_stop="false" \
  bash "$REPO_ROOT/scripts/stop-session.sh" 2>&1 | grep -v '^$' || true

assert_empty_dir "project file missing key + env false: no note written" "$VAULT_C/sessions"

# ── Results ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Results ==="
echo "Passed: $pass_count"
echo "Failed: $fail_count"
if [[ $fail_count -gt 0 ]]; then
  exit 1
fi
echo "All tests passed."
