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
