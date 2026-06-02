# Chronicle

Per-project persistent memory for any Claude agent. A Claude Code plugin that gives any agent
a searchable vault of notes, lessons, reminders, decisions, and references — backed by Markdown
files + a SQLite FTS5 index, surfaced through an MCP server, hooks, and `/chronicle:*` skills.

> Status: MVP built and verified end-to-end. Installs and loads cleanly in Claude Code 2.1.154
> (37 unit + 14 shell + smoke tests green; MCP server connects with 6 tools; all 4 skills load).
> Not yet on the public Anthropic marketplace — install from this repo (below) to use it today.

## Install

Requirements: [Claude Code](https://code.claude.com) (tested on 2.1.154) and [Bun](https://bun.sh)
on your PATH. Dependencies are installed automatically when the plugin is installed.

```sh
# 1. Register this repo as a plugin marketplace
claude plugin marketplace add https://github.com/kristianDKAndersen/Chronicle

# 2. Install the plugin
claude plugin install chronicle@chronicle-marketplace
```

That's it. Then, in a Claude Code session:

- `/plugin configure chronicle@chronicle-marketplace` — set the 6 onboarding options (or accept defaults)
- `/mcp` — confirm `chronicle` is connected with 6 `vault_*` tools
- `/help` — see the `/chronicle:remember`, `/chronicle:search`, `/chronicle:due`, `/chronicle:configure` commands

### Sharing internally

Anyone with access to this repo can run the two commands above — the marketplace URL is just the
repo URL, so no extra packaging or registry is needed before the public marketplace listing.

### Managing it

```sh
claude plugin list                        # see installed plugins + load status
claude plugin update chronicle            # pull a newer version after a push (bump version first)
claude plugin uninstall chronicle
claude plugin marketplace remove chronicle-marketplace
```

### Local development (without installing)

```sh
claude --plugin-dir /path/to/Chronicle/chronicle
```

## What you get

- **`/chronicle:remember`** — save a note (search-before-write to avoid duplicates); 8 note types
  (session, synthesis, lesson, decision, reminder, reference, checkpoint, constraint)
- **`/chronicle:search`** — full-text search across the vault, grouped by type
- **`/chronicle:due`** — surface notes with upcoming due dates
- **`/chronicle:configure`** — re-run onboarding / adjust capture behavior
- **Automatic capture** via hooks: a session summary on Stop, lesson candidates on tool failure,
  and due-note surfacing on session start (all configurable / toggleable)
- **MCP tools** for programmatic access: `vault_search`, `vault_due`, `vault_recent`,
  `vault_backlinks`, `vault_neighbors`, `vault_write`

Storage lives under `~/.claude/vault/projects/<slug>/` (Markdown source of truth + a rebuildable
SQLite index). See [`chronicle/README.md`](chronicle/README.md) for full onboarding, storage layout,
permission model, vault-growth/archival, and migration from an existing advisor vault.

## Layout

- `chronicle/lib/chronicle-vault.js` — core vault (Markdown + SQLite FTS5)
- `chronicle/servers/chronicle-server.js` — MCP server (6 tools)
- `chronicle/bin/chronicle-write` — hook dispatcher binary
- `chronicle/scripts/` — session / lesson / due / init / migrate scripts
- `chronicle/skills/` — `/chronicle:remember|search|due|configure`
- `chronicle/.claude-plugin/plugin.json` + `hooks/` + `.mcp.json` — plugin wiring
- `chronicle/tests/` — unit + integration + smoke tests
- `.claude-plugin/marketplace.json` — marketplace manifest (repo root)

## Run the tests

```sh
cd chronicle && bun install && bun test && bash tests/smoke.sh
```

## Changelog

Format based on [Keep a Changelog](https://keepachangelog.com); this project
follows [Semantic Versioning](https://semver.org).

### 1.0.2 — 2026-06-02

- **Fixed — auto-write now lands in the vault the MCP server reads.** Hooks
  wrote to the global default vault (`~/.claude/vault`) while the MCP server
  reads the per-project vault (`$DATA/projects/<slug>`), so auto-captured notes
  were stranded in a DB the reader never opens and `vault_recent` came back
  empty. `lib-options.sh` now exports `CHRONICLE_VAULT = $DATA/projects/<slug>`
  on source (mirroring the server's `resolveVaultRoot()`), fixing session,
  lesson, and due-check vault location in one shared place.
- **Fixed — empty note bodies.** Session notes are now driven off the Stop
  hook's `transcript_path` (session-id-keyed, upserted on every Stop with
  `created_at` preserved) and carry a real body: title, first prompt, branch,
  files touched, commands (with `VAR=` assignments filtered out), and last
  status. Lesson candidates capture the actual failed tool, action, and error
  from the `PostToolUseFailure` payload instead of a fixed string.
- **Fixed — hook stdout contract.** Corrected `2>&1 >&2` (which sent both
  streams to stdout) to `>&2`, keeping stdout empty as the pipeline contract
  requires.

### 1.0.1 — 2026-05-28

- **Added — project-level config override.** New shared resolver
  `chronicle/scripts/lib-options.sh` (`chronicle_opt <key> <default>`) with
  resolution order: project file (`.claude/chronicle-config.json`) >
  `CLAUDE_PLUGIN_OPTION_<key>` env > default. `stop-session.sh`,
  `lesson-candidate.sh`, and `check-due.sh` now source it and resolve each
  option through it.
- **Fixed — userConfig wiring.** Scripts read `CLAUDE_PLUGIN_OPTION_*`
  userConfig variables; dropped the unused `capture_profile`. Hook paths use
  `${CLAUDE_PLUGIN_ROOT}/bin` (hooks run via `/bin/sh` without the plugin
  `bin/` on `PATH`).
- **Changed.** Bumped `plugin.json` / `marketplace.json` to `1.0.1` so
  `claude plugin update` detects the change; documented the exact flat-JSON
  project-config shape in the `configure` skill.

### 1.0.0 — 2026-05-28

Initial MVP — built and verified end-to-end, installable from this repo.

- **Core vault** (`chronicle/lib/chronicle-vault.js`) — Markdown source of
  truth plus a rebuildable SQLite FTS5 index; 8 note types (session,
  synthesis, lesson, decision, reminder, reference, checkpoint, constraint).
- **MCP server** (`chronicle/servers/chronicle-server.js`) — 6 tools:
  `vault_search`, `vault_due`, `vault_recent`, `vault_backlinks`,
  `vault_neighbors`, `vault_write`.
- **Skills** — `/chronicle:remember` (search-before-write), `/chronicle:search`,
  `/chronicle:due`, `/chronicle:configure`.
- **Automatic capture via hooks** — session summary on Stop, lesson candidates
  on tool failure, due-note surfacing on session start (all configurable).
- **Archival & growth** — `archiveNotes`/`listArchived` plus `archive`/`prune`
  subcommands with count-checks.
- **Migration** — non-destructive `migrate-from-advisor.sh` + `import`
  subcommand to bring across an existing advisor vault.
- **Packaging** — spec-compliant plugin contract (`userConfig` object,
  `CLAUDE_PROJECT_DIR`-based slug), `chronicle-marketplace` manifest, and repo
  install/sharing docs.
- **Tests** — 37 unit + 14 shell + integration smoke, all green.
