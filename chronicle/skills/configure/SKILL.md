---
name: /chronicle:configure
description: Interactively configure Chronicle vault settings. Supports profile shortcuts and per-project overrides.
---

# /chronicle:configure

Trigger when the user says "configure chronicle", "change chronicle settings", or "set chronicle options".

## Profile shortcuts

Ask this first: "Would you like to start from a preset profile — minimal, balanced, or aggressive?"

- `minimal`: explicit-only captures, all auto-behaviors off, prune threshold 500
- `balanced`: hybrid captures, all auto-behaviors on, prune threshold 1000
- `aggressive`: auto captures, all auto-behaviors on, prune threshold 5000

If the user picks a profile, apply all five knob values at once. Then ask if they want to override any individual knob. If they say "custom" or skip the profile question, walk through each knob below individually.

## Knobs

Present each knob with its current value as the default. Accept Enter to keep the current value.

**significance_mode** — Which events trigger automatic note creation. Options: `auto`, `hybrid`, `explicit-only`. Default: `hybrid`.

**auto_write_on_stop** — Write a session summary when the session ends. Options: `true` / `false`. Default: `true`.

**lesson_on_failure** — Record a lesson candidate whenever a Bash tool use fails. Options: `true` / `false`. Default: `true`.

**surface_due_on_start** — Surface upcoming due notes at the start of each session. Options: `true` / `false`. Default: `true`.

**max_notes_before_prune** — Warn when the vault exceeds this many notes (0 = disabled). Accepts any integer >= 0. Default: `1000`.

## Writing settings

### Global (default)

Merge the updated values into `pluginConfigs.chronicle.options` in `~/.claude/settings.json`. Do not overwrite keys not modified in this session.

### Project-level override (`--project` flag)

When invoked as `/chronicle:configure --project`, write to `<repo>/.claude/chronicle-config.json` instead. Project-level values take precedence over global values at runtime. The plugin reads the project file first and falls back to the global config (env var `CLAUDE_PLUGIN_OPTION_<key>`) for any key absent from the project file.

**File shape** — flat JSON object, keys match the knob names exactly:

```json
{
  "significance_mode": "hybrid",
  "auto_write_on_stop": false,
  "lesson_on_failure": true,
  "surface_due_on_start": true,
  "max_notes_before_prune": 1000
}
```

Only include keys you want to override — omitted keys fall back to the global config or the default listed above. Do not wrap values in a nested object; the file is a single flat map of `key -> value` at `<repo>/.claude/chronicle-config.json`.

## Fallback

If the agent cannot write to `~/.claude/settings.json` (permission denied), print the JSON block and instruct the user to paste it into their settings file manually.
