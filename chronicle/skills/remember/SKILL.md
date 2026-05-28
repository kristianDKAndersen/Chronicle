---
name: /chronicle:remember
description: Save a note to the Chronicle vault. Enforces search-before-write to prevent duplicates.
---

# /chronicle:remember

Trigger when the user says "remember this", "save this to vault", or "chronicle this".

## Search-before-write (mandatory)

Before writing a factual observation, search the vault for an existing note on the same topic and update it rather than creating a duplicate.

1. Call `vault_search` with the topic or key phrase from what the user wants to save.
2. If a near-match is found (same subject, overlapping content), call `vault_write` with the existing note's `relPath` to update it.
3. Only create a new note (new `relPath`) when no near-match exists.

## Supported note types

| Type | Use case |
|------|----------|
| `session` | Summary of what happened in this work session |
| `synthesis` | Cross-session insight or pattern established |
| `lesson` | What went wrong and what to do differently |
| `decision` | Architectural or design choice made |
| `reminder` | A time-sensitive action item with a due date |
| `reference` | External link, doc, or resource to keep |
| `checkpoint` | Snapshot of project state at a milestone |
| `constraint` | A hard rule or invariant that must not be violated |

## Required frontmatter fields

Every note written via this skill must include all five fields:

```yaml
type: <one of the 8 types above>
agent: <agent name, e.g. claude-sonnet-4-6>
created_at: <ISO 8601 timestamp>
project: <project slug>
session_id: <current session ID from CHRONICLE_SESSION_ID>
```

## Reminder type — additional prompts

When the user chooses `type: reminder`, prompt for two additional fields before writing:

- `due_date` — the date or datetime by which the action is needed (ISO 8601)
- `urgency` — one of: `low`, `medium`, `high`, `critical`

Add these to the note frontmatter:

```yaml
due_date: <ISO 8601 date>
urgency: <low|medium|high|critical>
```

## Tool call sequence

```
1. vault_search({ query: "<topic>", limit: 5 })
   → if match: vault_write({ relPath: "<existing path>", frontmatter: {...}, body: "<updated body>" })
   → if no match: vault_write({ relPath: "<type>/<slug>.md", frontmatter: {...}, body: "<body>" })
```

## relPath convention

New notes: `<type>/<YYYY-MM-DD>-<slug>.md`

Example: `lesson/2026-05-28-bun-sqlite-wal-mode.md`

## Body format

Use plain Markdown. Keep the first line as a one-sentence summary — it becomes the snippet shown in search results.
