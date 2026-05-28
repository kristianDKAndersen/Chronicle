---
name: /chronicle:due
description: Show Chronicle vault notes with upcoming or overdue due dates.
---

# /chronicle:due

Trigger when the user asks "what's due", "show reminders", "what do I need to follow up on", or starts a session with `surface_due_on_start` enabled.

## MCP tool

`vault_due` — returns notes where `due_date` is within the requested window and `status` is not `done`.

## Default behavior

Call `vault_due({ withinDays: 3 })` unless the user specifies a different window.

```
vault_due({ withinDays: <N> })
```

Common window values:
- `1` — due today or overdue
- `3` — default: due within 3 days (includes today)
- `7` — due this week
- `30` — due this month

## Output format

List notes sorted by `due_date` ascending (most urgent first), with urgency label.

```
### Overdue
- [CRITICAL] Fix WAL mode on Windows (lesson/2026-05-20-wal-windows.md) — due 2026-05-25

### Due today
- [HIGH] Publish v1.0 release notes (reminder/2026-05-28-release-notes.md) — due 2026-05-28

### Due in 1-3 days
- [MEDIUM] Review PR #42 (reminder/2026-05-30-pr-42-review.md) — due 2026-05-30
```

If no notes are due within the window, say: "No notes due within <N> days."

## Dismissing a note

When the user says "done", "mark as done", or "dismiss" for a note, call:

```
vault_write({
  relPath: "<note relPath>",
  frontmatter: { status: "done" },
  body: "<existing body>"
})
```

This removes the note from future `vault_due` results without deleting the file.

## Urgency levels

| Label | Meaning |
|-------|---------|
| `critical` | Blocking — must be done now |
| `high` | Due today or tomorrow |
| `medium` | Due within the week |
| `low` | No immediate pressure |
