---
name: install-hooks
description: >-
  Install the sdlc-workflow git hooks into the current repository so the
  [TICKET-ID] commit convention and <type>/TICKET-ID-description branch naming are
  enforced locally. Use when the user runs /sdlc-workflow:install-hooks, asks to
  set up or enable the git hooks, or when the SessionStart reminder says hooks
  aren't installed. Sets core.hooksPath and stores the ticket prefix in local git
  config. Won't clobber an existing husky / hooksPath setup without --force.
allowed-tools: >-
  Bash(git config*) Bash(git rev-parse*) Bash(git symbolic-ref*)
  Bash(sh*) Bash(ls*) Bash(cat*)
---

# Install the git hooks

Wires this repo's local hooks to the plugin's templates via `core.hooksPath`, so
commits and pushes are checked against the conventions (see the
[git skill](../git/SKILL.md)).

## Steps

1. Confirm you're in a git repo (`git rev-parse --is-inside-work-tree`).
2. Determine the **ticket prefix**:
   - Use the `jiraProjectKey` user config if set.
   - Else, try to infer it from existing branches/commits
     (`git branch --format='%(refname:short)'` → look for an `ABC-123` pattern).
   - Else, ask the user for their project key (or proceed with no prefix → the
     hooks fall back to a permissive `UPPERCASE-123` pattern).
3. Run the installer (it ships beside the plugin):

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/bin/install-git-hooks" --prefix "<KEY>"
   ```

   - Pass `--lint "<cmd>"` only if the user configured `lintCommand` (e.g.
     `eslint`, `ruff check`) — otherwise leave the pre-commit lint disabled.
   - If it warns that `.husky/` or an existing `core.hooksPath` is present, **do
     not** silently override. Tell the user and only re-run with `--force` (or a
     matching `--hooks-dir`) if they confirm.
4. Report what was set (hooks dir, prefix) and remind the user they can **commit
   the hooks dir** to share with the team or leave it untracked for local-only.

## Notes

- `core.hooksPath` is per-clone, so each teammate runs this once per repo (or the
  repo adds a `prepare`-style setup step). The hooks themselves are dependency-free
  POSIX `sh` — no husky package required.
- The prefix is stored in `git config sdlc.ticketPrefix`; the lint command in
  `git config sdlc.lintCommand`. Both are local and never committed.
