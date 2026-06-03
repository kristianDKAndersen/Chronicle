# SDLC Workflow — ticket-driven git for Claude Code

A Claude Code plugin that makes every change traceable to a Jira ticket:

1. **`/sdlc-workflow:ticket`** — resolve the ticket the work is tracked under
   (use an existing one, create a new one, or create one **from a Slack thread**),
   then open a compliant branch for it.
2. **`/sdlc-workflow:git`** — branch/commit/PR conventions: `[TICKET-ID]` commit
   subjects and `<type>/TICKET-ID-description` branch names.
3. **`/sdlc-workflow:install-hooks`** — install dependency-free git hooks that
   enforce those conventions locally (`commit-msg`, `prepare-commit-msg`,
   `pre-push`, optional `pre-commit` lint).

It hardcodes **no** organization-specific values: the Atlassian cloudId is
discovered at runtime, and the project key / base branch / lint command come from
plugin config or git auto-detection.

## Install

```
/plugin marketplace add kristianDKAndersen/Chronicle
/plugin install sdlc-workflow@chronicle-marketplace
```

Then configure (Settings → Plugins → SDLC Workflow), or leave blank to be
prompted / auto-detected:

| Setting | Meaning | Default |
|---------|---------|---------|
| `jiraProjectKey` | Ticket prefix / default project (e.g. `ABC`) | empty → prompt / permissive |
| `jiraCloudId` | Atlassian cloudId or site host | empty → auto-discover |
| `baseBranch` | Branch new work is cut from | empty → auto-detect `origin/HEAD` → `main` |
| `defaultIssueType` | Issue type for new tickets | `Task` |
| `lintCommand` | Optional check-only pre-commit lint (e.g. `eslint`) | empty → disabled |

## MCP connectors (you authenticate these yourself)

The ticket flow uses two **claude.ai connectors** — the plugin can't bundle them
or your credentials. Add and authenticate them once via `/mcp`:

- **Atlassian (Jira)** — required for fetching/creating tickets.
- **Slack** — required only for "create a ticket from a Slack thread" (Path 3).

If a connector isn't authenticated, the relevant skill tells you and stops rather
than guessing.

## Git hooks

`/sdlc-workflow:install-hooks` copies the hook scripts into a repo-local
`.githooks/` directory and sets `core.hooksPath`. They are plain POSIX `sh` — **no
husky / npm dependency**. The ticket prefix is stored in `git config
sdlc.ticketPrefix`; an optional lint command in `git config sdlc.lintCommand`.

- It **won't clobber** an existing `core.hooksPath` or `.husky/` setup without
  `--force`.
- `core.hooksPath` is per-clone, so each teammate runs the install once per repo
  (or commit `.githooks/` and add your own one-line setup step).
- With **no prefix configured**, the hooks accept any `UPPERCASE-123` ticket, so
  they work before you set a project key.

> Local hooks are a convenience guardrail, not enforcement — a developer can
> `git commit --no-verify`. For true team-wide enforcement, pair these with a CI
> check on the pull request.

## Development

```
claude --plugin-dir ./sdlc-workflow
```

Run the smoke test:

```
sh sdlc-workflow/tests/smoke.sh
```
