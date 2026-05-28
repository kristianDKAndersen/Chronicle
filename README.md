# Chronicle

Per-project persistent memory for any Claude agent. A Claude Code plugin that generalizes the advisor vault into a drop-in plugin usable by any agent.

Status: MVP built (Phases 0-8 complete, all tests green). See `chronicle/README.md` for installation, onboarding, and usage.

## Layout

- `chronicle/lib/chronicle-vault.js` - core vault (markdown + SQLite FTS5)
- `chronicle/servers/chronicle-server.js` - MCP server (6 tools)
- `chronicle/bin/chronicle-write` - hook dispatcher binary
- `chronicle/scripts/` - session/lesson/due/init/migrate scripts
- `chronicle/skills/` - /chronicle:remember|search|due|configure
- `chronicle/.claude-plugin/plugin.json` + `hooks/` + `.mcp.json` - plugin wiring
- `chronicle/tests/` - unit + integration + smoke tests

Run `cd chronicle && bun install && bun test` then `bash tests/smoke.sh`.
