---
name: git
description: >-
  Ticket-driven git conventions — compliant branch names, commit messages, and
  pull requests. Use whenever creating a branch, writing a commit message,
  committing, or opening a PR, and whenever the user mentions git, branches,
  commits, ticket IDs, or pull requests. Commits must be `[TICKET-ID] description`
  with a real ticket (no all-zero placeholder); branches must be
  `<type>/TICKET-ID-description`. These rules are enforced by the git hooks
  installed via /sdlc-workflow:install-hooks, so following them here avoids a
  rejected commit or push. To resolve or create the ticket first, use
  /sdlc-workflow:ticket.
allowed-tools: >-
  Bash(git status*) Bash(git branch*) Bash(git log*) Bash(git diff*)
  Bash(git rev-parse*) Bash(git symbolic-ref*) Bash(git config*)
  Bash(gh pr view*) Bash(gh pr list*)
---

# Git workflow

Every change is traceable to a ticket. The branch name carries the ticket into
commits — the `prepare-commit-msg` hook derives `[TICKET-ID]` from the branch, and
`commit-msg` enforces it. The **ticket prefix** comes from `git config
sdlc.ticketPrefix` (set at install). Where this skill shows `ABC` below, it stands
for that configured project key.

## Repo state right now

- Current branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null`
- Configured prefix: !`git config --get sdlc.ticketPrefix 2>/dev/null || echo '(none — permissive pattern)'`
- Recent commits: !`git log --oneline -n 8 2>/dev/null`

## Commit messages

Every commit subject **must** start with the ticket in this exact form:

```
[ABC-123] short description in the imperative
```

An **all-zero placeholder** (`[ABC-0000]`) is **rejected** — it breaks the
traceability the ticket prefix exists to provide, so always use the real ticket.
The `commit-msg` hook blocks anything else.

**Good:** `[ABC-123] add co-applicant SSN validation`
**Bad:** `ABC-123: add validation` (wrong form) · `[ABC-0000] wip` (placeholder) · `fix stuff` (no ticket)

If the current branch already contains the ticket (e.g. `feature/ABC-123-...`), the
`prepare-commit-msg` hook prepends `[ABC-123] ` for you automatically — write just
the description and it becomes compliant. When committing on the user's behalf,
write the full message and add any co-author trailer your environment requires
(one blank line before it).

## Branch names

Format is **type first, ticket second**, then a short kebab-case description:

```
<type>/ABC-123-short-description
```

Approved `<type>` values: `feature` `bugfix` `hotfix` `refactor` `chore`
`incident`. Anything else is rejected on push by the `pre-push` hook.

| Type | Use for |
|------|---------|
| `feature/` | New functionality |
| `bugfix/` | Non-production bug fixes |
| `hotfix/` | Urgent production fixes |
| `refactor/` | Code restructuring without behaviour change |
| `chore/` | Maintenance, dependency updates, tooling |
| `incident/` | Emergency production incident patches |

**Banned:** person-name prefixes (`alex/`, `sam/`, …) and `epic/` / `story/` — map
those to `feature/`. Never commit directly to `main`.

Create a branch off the latest base branch:

```bash
git switch main && git pull
git switch -c feature/ABC-123-co-applicant-validation
```

**Need the ticket first?** If you don't yet have a ticket for this work — or need
to create one (including from a Slack thread) — use the
[/sdlc-workflow:ticket skill](../ticket/SKILL.md). It resolves the ticket and
creates this branch for you, then hands back here for commits and the PR.

## Pull requests

Reach `main` through a PR (peer approval where your team requires it) — no direct
pushes to `main`. Open one with:

```bash
gh pr create --base main --title "[ABC-123] add co-applicant validation" --body "$(cat <<'EOF'
## Summary
- what changed and why

## Testing
- how it was verified
EOF
)"
```

## What the hooks enforce (so you don't get surprised)

- `commit-msg` — rejects any subject not matching `[<prefix>-<n>] ` and rejects an all-zero ticket.
- `prepare-commit-msg` — auto-prepends the ticket from the branch name; prompts only at a real terminal (never hangs CI/agents).
- `pre-push` — rejects branch names that don't match `<type>/<prefix>-<n>-...`.
- `pre-commit` — optional; runs a configured check-only lint (`sdlc.lintCommand`) on staged files, no-op if unset.

Install or repair them with [/sdlc-workflow:install-hooks](../install-hooks/SKILL.md).

## Full reference

For the complete convention table and the `epic`/`story` → `feature` mapping, see
[references/conventions.md](references/conventions.md).
