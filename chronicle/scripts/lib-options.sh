#!/usr/bin/env bash
# lib-options.sh — shared option resolver for chronicle scripts.
# Source this file, then call: chronicle_opt <key> <default>
#
# Resolution order:
#   1. $CLAUDE_PROJECT_DIR/.claude/chronicle-config.json key (if file exists and key present)
#   2. CLAUDE_PLUGIN_OPTION_<key> env var (if set and non-empty)
#   3. <default>

chronicle_opt() {
  local key="$1"
  local default="$2"

  # 1. Project-level config file
  if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
    local proj_file="${CLAUDE_PROJECT_DIR}/.claude/chronicle-config.json"
    if [[ -f "$proj_file" ]]; then
      local val
      val=$(CHRONICLE_OPT_FILE="$proj_file" CHRONICLE_OPT_KEY="$key" \
        bun --eval "
          import { readFileSync } from 'fs';
          const f = process.env.CHRONICLE_OPT_FILE;
          const k = process.env.CHRONICLE_OPT_KEY;
          try {
            const d = JSON.parse(readFileSync(f, 'utf8'));
            if (k in d) { process.stdout.write(String(d[k])); process.exit(0); }
          } catch(e) {}
          process.exit(1);
        " 2>/dev/null) && { printf '%s' "$val"; return; }
    fi
  fi

  # 2. Env var (indirect expansion)
  local _envvar="CLAUDE_PLUGIN_OPTION_${key}"
  local _envval="${!_envvar:-}"
  if [[ -n "$_envval" ]]; then
    printf '%s' "$_envval"
    return
  fi

  # 3. Default
  printf '%s' "$default"
}

# ── Vault root convergence ───────────────────────────────────────────────────
# Hooks run chronicle-vault.js (Bun) directly. Without CHRONICLE_VAULT set, the
# lib falls through to the global default (~/.claude/vault), while the MCP server
# resolves the per-project vault ($DATA/projects/<slug>) and reads THERE — so
# hook-written notes were stranded in a DB the reader never opens. Mirror the
# server's resolution here so every sourcing script writes/reads the same vault.
# (Server: servers/chronicle-server.js → resolveVaultRoot.)
if [[ -z "${CHRONICLE_VAULT:-}" ]]; then
  _chronicle_slug="${CHRONICLE_PROJECT_SLUG:-$(basename "${CLAUDE_PROJECT_DIR:-$PWD}")}"
  _chronicle_data="${CHRONICLE_DATA_DIR:-${CLAUDE_PLUGIN_DATA:-${HOME}/.claude/plugin-data}}"
  if [[ -n "$_chronicle_slug" && -n "$_chronicle_data" ]]; then
    export CHRONICLE_VAULT="$_chronicle_data/projects/$_chronicle_slug"
    export CHRONICLE_RESOLVED_SLUG="$_chronicle_slug"
    # The lib prefers CHRONICLE_PROJECT_SLUG (→ ~/.claude/vault/projects/<slug>),
    # which would ignore CHRONICLE_VAULT. Clear it so CHRONICLE_VAULT wins.
    unset CHRONICLE_PROJECT_SLUG
  fi
  unset _chronicle_slug _chronicle_data
fi
