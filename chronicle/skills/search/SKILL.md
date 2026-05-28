---
name: /chronicle:search
description: Search the Chronicle vault for notes by keyword, backlinks, or graph neighbors.
---

# /chronicle:search

Trigger when the user asks to search their vault, look up a past decision, find related notes, or ask "what did I save about X".

## MCP tools

| Tool | When to use |
|------|-------------|
| `vault_search` | Full-text keyword search across all note bodies |
| `vault_backlinks` | Find notes that link to a given note by name |
| `vault_neighbors` | Traverse the note graph to depth N from a starting note |

## Workflow

1. Parse the user's query into a search term.
2. Call `vault_search({ query: "<term>", limit: 20 })` as the primary lookup.
3. If the user asks "what links to X" or "what references X", also call `vault_backlinks({ noteName: "<X>" })`.
4. If the user asks for related or connected notes, call `vault_neighbors({ noteName: "<X>", depth: 2 })`.
5. Merge and deduplicate results by `relPath`.
6. Present results grouped by type (see output format below).

## Output format

Group results by note `type`, ordered by relevance rank within each group. Show a one-line snippet from each note body.

```
### decision (3)
- [2026-05-01-use-bun-sqlite.md] Use bun:sqlite over better-sqlite3 for native Bun support. (rank 0.97)
- [2026-04-20-wal-mode.md] WAL mode enabled for concurrent read performance. (rank 0.84)

### lesson (1)
- [2026-05-10-migration-encoding.md] UTF-8 BOM caused frontmatter parse failures on Windows. (rank 0.71)

### reference (2)
- [2026-04-15-bun-sqlite-docs.md] Official bun:sqlite API reference. (rank 0.65)
- [2026-03-30-mcp-sdk-types.md] MCP SDK TypeScript types for tool definitions. (rank 0.60)
```

If no results are found, say: "No notes matched '<query>' in the vault." and suggest a broader term.
