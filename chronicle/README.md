# Chronicle

Chronicle is a Claude Code plugin that captures session notes, lessons, and reminders in a per-project vault. It hooks into Claude Code's lifecycle (SessionStart, Stop, PostToolUseFailure) to write structured Markdown notes into a local SQLite-indexed vault, then surfaces them through MCP tools and slash commands.

## Installation

1. Clone or copy the `chronicle/` directory to a location on your machine (e.g. `~/.claude/plugins/chronicle/`).

2. **Install dependencies** — Chronicle's MCP server and vault library require [Bun](https://bun.sh). Run this once inside the `chronicle/` directory before enabling the plugin or running tests:

   ```sh
   cd chronicle/
   bun install
   ```

   `node_modules/` is gitignored and must be installed locally. The vault library (`lib/chronicle-vault.js`) uses `bun:sqlite` and will not work under plain Node.js.

3. Register the plugin in Claude Code by adding the `.mcp.json` and `.claude-plugin/plugin.json` paths to your Claude Code config, or by placing the `chronicle/` directory in the location Claude Code scans for plugins.

4. Add `chronicle-write` to your shell `PATH` (e.g. symlink `chronicle/bin/chronicle-write` into `~/.local/bin/`) so Claude Code hooks can call it.

5. Enable the plugin in your project with `/chronicle:configure` to answer the onboarding questions and write your `userConfig`.

### Install via marketplace

If you have the Chronicle repository available locally (or pushed to a remote), you can register it as a Claude Code marketplace and install Chronicle through the standard plugin registry:

```sh
# Register the marketplace (point at the repo root where .claude-plugin/marketplace.json lives)
claude plugin marketplace add /Users/awesome/dev/AI/Chronicle
# or, once the repo is pushed:
# claude plugin marketplace add https://github.com/you/Chronicle

# Then install Chronicle from the marketplace
claude plugin install chronicle@chronicle-marketplace
```

The `--plugin-dir` flag remains available for local development:

```sh
claude --plugin-dir /path/to/chronicle
```

## Onboarding

On first run, the `session-start` hook calls `first-run-init.sh` which creates your project vault directories. The `/chronicle:configure` skill guides you through five `userConfig` fields:

| Field | What it does |
|-------|-------------|
| `capture_profile` | Capture depth: `quiet` (session notes only), `standard` (session + lessons), or `verbose` (all note types) |
| `lesson_on_failure` | Whether to auto-capture a lesson candidate on PostToolUseFailure (default `true`) |
| `significance_mode` | `hybrid` auto-captures and accepts explicit `/remember` entries; `explicit-only` captures nothing automatically |
| `auto_write_on_stop` | Whether to write a session note on Stop hook (default `true`) |
| `surface_due_on_start` | Whether to surface due reminders at SessionStart (default `true`) |

**Capture profiles:**
- `quiet` — writes a session note on Stop; no auto-lessons; good for low-noise workflows.
- `standard` — default; session notes + lesson candidates on failures.
- `verbose` — all note types; explicit `/remember` calls; useful when actively building a memory base.

## Slash commands

Chronicle exposes four slash commands under the `chronicle` namespace:

| Command | What it does |
|---------|-------------|
| `/chronicle:remember` | Prompt Claude to write a note to the vault right now (any type: lesson, decision, reminder, reference) |
| `/chronicle:search` | Full-text search the vault via BM25; returns ranked snippets |
| `/chronicle:due` | List notes with due dates falling within the next 14 days |
| `/chronicle:configure` | Re-run the onboarding questionnaire; update `userConfig` fields |

## Storage layout

Each project gets its own subdirectory under the vault root:

```
~/.claude/vault/projects/<slug>/
  sessions/          # one .md per session (written on Stop)
  lessons/           # candidate lessons from PostToolUseFailure; /remember entries
  decisions/         # architectural and process decisions
  reminders/         # notes with due_date frontmatter
  references/        # links, docs, external resources
  checkpoints/       # mid-session snapshots
  constraints/       # hard rules to carry forward
  synthesis/         # cross-session synthesis notes
  archive/           # notes moved by `chronicle-write archive`
  .cache/vault.db    # SQLite FTS5 index (gitignored)
  initialized        # sentinel file created on first run
```

`<slug>` defaults to `$CHRONICLE_PROJECT_SLUG` or `$(basename "$PWD")`. The vault root is `~/.claude/vault/projects/<slug>/` unless overridden by `CHRONICLE_VAULT`.

The current session ID is stored at:

```
$CLAUDE_PLUGIN_DATA/<slug>/current-session-id
```

This file is created by `session-start` and deleted by `stop-session`.

## Permission model

`chronicle-write` is a shell binary that writes files and runs Bun. Claude Code's allowlist must include it before the hooks fire.

Add this to your `settings.json` (or the project-level `.claude/settings.json`):

```json
{
  "permissions": {
    "allow": [
      "Bash(chronicle-write:*)"
    ]
  }
}
```

If `chronicle-write` is not on `PATH`, use the full path:

```json
{
  "permissions": {
    "allow": [
      "Bash(/path/to/chronicle/bin/chronicle-write:*)"
    ]
  }
}
```

**Why it is safe:** `chronicle-write` only reads and writes Markdown files under your configured vault root and a session-ID file under `CLAUDE_PLUGIN_DATA`. It does not make network calls, does not modify source code, and does not read your project files. The binary is a plain bash dispatcher that delegates to shell scripts and short Bun evals.

Note: The plugin hooks (SessionStart, Stop, PostToolUseFailure) run only when Claude Code invokes them; Chronicle does not run as a daemon or background process.

## Vault growth

Vault size grows over time as sessions accumulate. Three mechanisms keep it manageable:

**Archive** — moves old session notes to `archive/`:

```sh
chronicle-write archive            # archive sessions older than 180 days
chronicle-write archive --dry-run  # preview what would be archived
```

**Prune** — removes fixture and near-empty notes:

```sh
chronicle-write prune            # remove notes with short/fixture bodies
chronicle-write prune --dry-run  # preview what would be removed
```

**Count threshold** — if you set `CHRONICLE_PLUGIN_OPTION_MAX_NOTES_BEFORE_PRUNE` in the hook env, Chronicle warns you at SessionStart when the vault exceeds that count.

Recommended schedule: run `chronicle-write archive` monthly, `chronicle-write prune` after any mass-import.

## Migration from advisor vault

If you have an existing `.advisor/vault/` from the Advisor tool, import it into Chronicle with:

```sh
chronicle-write import --source ~/.advisor/vault --target <slug>
```

Replace `<slug>` with your project's slug (e.g. the basename of your project directory).

The import script (`scripts/migrate-from-advisor.sh`) performs a **non-destructive** copy: notes are read from the source vault and written into the Chronicle vault under `<slug>/`. Original Advisor vault files are not modified or deleted. Duplicate paths are skipped.

To preview without writing:

```sh
chronicle-write import --source ~/.advisor/vault --target <slug> --dry-run
```

## MCP server runtime

Chronicle's MCP server (`servers/chronicle-server.js`) runs under **Bun**. Node.js is not supported because the vault library uses `bun:sqlite`.

**Before starting the server, `bun install` must have been run** inside the `chronicle/` directory (see Installation). The `node_modules/` directory is gitignored and is not included in the repository.

The `.mcp.json` wires the server into Claude Code:

```json
{
  "mcpServers": {
    "chronicle": {
      "command": "bun",
      "args": ["servers/chronicle-server.js"],
      "env": {
        "CHRONICLE_DATA_DIR": "${CLAUDE_PLUGIN_DATA}",
        "CHRONICLE_PROJECT_SLUG": "${CLAUDE_PROJECT_SLUG}"
      }
    }
  }
}
```

The server exposes six MCP tools: `vault_search`, `vault_due`, `vault_recent`, `vault_backlinks`, `vault_neighbors`, `vault_write`.

SDK version confirmed working: `@modelcontextprotocol/sdk@1.29.0` under Bun 1.x.

If Bun is unavailable in your environment, the MCP server cannot run. The shell scripts (`chronicle-write` subcommands) will fall through their `if command -v bun` guard and log a warning to stderr, leaving vault writes as no-ops rather than failing the hook.

## C → D graduation

Chronicle is currently Alternative C (per-project, home-based vault). Graduating to Alternative D (federation index across projects) is appropriate when any of these conditions are met:

1. **Cross-project lesson queries are frequent** — you regularly want to search lessons from project A while working in project B.
2. **Manual migration fatigue** — the per-project import workflow (`chronicle-write import`) has become a recurring burden.
3. **Vault fragmentation** — related notes for the same system are spread across multiple project vaults with no way to query them together.
4. **Team sharing** — more than one developer needs read access to vault notes from projects they don't personally run.
5. **Index size** — individual project vaults exceed ~5 000 notes and a shared FTS index would meaningfully improve search precision via cross-project BM25 scoring.

Before graduating: export all per-project vaults, merge them into a single root, update `CHRONICLE_VAULT` to point at the merged root, and run `chronicle-write import` (or a direct `cp` + `rebuildIndex()` call) to re-index.
