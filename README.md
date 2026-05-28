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
