---
name: ticket
description: >-
  Start work by resolving the Jira ticket the work will be tracked under, then
  opening a compliant git branch for it. Use whenever the user runs
  /sdlc-workflow:ticket, says they are "starting work" or "picking up a task",
  needs a ticket before committing, hands you a ticket ID to work on, or wants to
  create a new Jira ticket (including from a Slack thread). Resolves a ticket
  (existing / new / from Slack), then creates and switches to
  `<type>/TICKET-ID-description` so the git hooks feed `[TICKET-ID]` into every
  commit. Hands off to the /sdlc-workflow:git skill for commits and PRs.
allowed-tools: >-
  Bash(git status*) Bash(git branch*) Bash(git log*) Bash(git rev-parse*)
  Bash(git symbolic-ref*) Bash(git switch*) Bash(git pull*) Bash(git fetch*)
  Bash(git checkout*) Bash(git config*)
---

# Start work mode

The front door to doing work: end up with a real Jira ticket and a compliant
branch for it. The branch name carries the ticket into commits (see the
[git skill](../git/SKILL.md)).

## Repo state right now

- Current branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null`
- Working tree: !`git status --short 2>/dev/null | head -n 20`
- Configured prefix: !`git config --get sdlc.ticketPrefix 2>/dev/null || echo '(none set)'`

## Configuration (no hardcoded IDs)

Resolve these at runtime — never assume a fixed value:

- **cloudId** — use the `jiraCloudId` user config if set; otherwise **discover it**
  by calling `getAccessibleAtlassianResources` and using the returned site id.
- **project key** — use the `jiraProjectKey` user config; else infer from
  `git config sdlc.ticketPrefix` or recent branch/commit ticket IDs; else ask.
- **base branch** — `baseBranch` user config, else auto-detect:
  `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/`,
  fallback `main`.
- **self (assignee)** — `atlassianUserInfo` (current user) when you need an account id.

See [references/jira.md](references/jira.md) for exact tool names and arguments.

## The flow

```
/sdlc-workflow:ticket
 ├─ 1. Add existing ticket   → user gives TICKET-ID → fetch from Jira, show summary, confirm
 ├─ 2. Create new ticket     → draft title/type/description → confirm → create
 └─ 3. Create from a source  → Slack thread → extract → draft → confirm → create
        │
        ▼  (ticket resolved → TICKET-ID)
   create & switch branch  <type>/TICKET-ID-short-description  (off base branch)
        │
        ▼
   hand off to /sdlc-workflow:git  → commits & PR all carry [TICKET-ID]
```

When invoked with no clear intent, present the three options and ask. If the user
already gave a ticket id or a Slack link, skip the menu and go to that path.

> **Before touching git, check the working tree** (above). If there are
> uncommitted changes, do **not** silently switch away — point them out and ask
> whether to stash, commit first, or carry them onto the new branch.

---

## Path 1 — Add an existing ticket

1. Resolve cloudId (above) and fetch the issue with `getJiraIssue`
   (`issueIdOrKey = TICKET-ID`).
2. If it doesn't exist or the lookup fails, say so and stop — don't branch on a
   ticket that may not exist. Offer to create one (Path 2).
3. Show a one-line confirmation: **`TICKET-ID — <summary>` (`<type>`, `<status>`)**.
   Get a yes.
4. Proceed to **Open the branch**.

## Path 2 — Create a new ticket

Gather the minimum, draft it, **show the draft and get explicit approval**, then
create. Never create a Jira ticket without showing the draft first.

1. Collect:
   - **Summary** — short imperative title.
   - **Issue type** — default from the `defaultIssueType` config (Task); **Bug**
     for a defect, **Story** for a user story. Note: branch *prefix* is a separate
     axis from issue type — see "Open the branch".
   - **Description** — a sentence or two; expand from what the user said.
2. Present the draft (project key, type, summary, description, assignee = self).
3. On approval, create with `createJiraIssue` (`projectKey`, `issueTypeName`,
   `summary`, `description` with `contentFormat: "markdown"`, optional
   `assignee_account_id` = self). Report the new key.
4. Proceed to **Open the branch**.

## Path 3 — Create a ticket from a Slack thread

1. Ask for the **Slack message permalink** (message ⋯ menu → *Copy link*).
2. Load the Slack tools with `ToolSearch`. If only an `authenticate` stub is
   available, Slack isn't connected — tell the user to authenticate the Slack
   connector via `/mcp`, or fall back to pasted thread text. Don't fabricate Slack
   content.
3. **There is no fetch-by-URL tool** — `slack_read_thread` needs `channel_id` +
   `message_ts`. Parse them from the permalink (the `archives/<channel_id>/p<digits>`
   segment, decimal inserted 6 digits from the end; prefer a `?thread_ts=` query
   param if present). Parsing rule + the search fallback are in
   [references/jira.md](references/jira.md). Then **summarize the thread back** so
   the user confirms you understood the ask.
4. Draft a ticket from it (same format as Path 2); include the originating ask and
   the permalink in the description. Show the draft, get approval, create, report
   the key.
5. Proceed to **Open the branch**.

---

## Open the branch (all paths converge here)

Once you have a confirmed `TICKET-ID`:

1. Pick the branch **type prefix** from the *nature of the work*, not the issue
   type (two separate axes — full table in
   [the git conventions](../git/references/conventions.md)):

   | Nature of the work | Branch prefix |
   |--------------------|---------------|
   | New functionality | `feature/` |
   | Non-production bug fix | `bugfix/` |
   | Urgent production fix | `hotfix/` |
   | Refactor (no behaviour change) | `refactor/` |
   | Maintenance / deps / tooling | `chore/` |
   | Emergency incident patch | `incident/` |

   `epic/` and `story/` are not approved → `feature/`. When ambiguous, default to
   `feature/` and confirm.
2. Build a short kebab-case description from the summary (3–5 words). Confirm if
   not obvious.
3. Create off the detected base branch:
   ```bash
   git switch <base> && git pull
   git switch -c <type>/TICKET-ID-short-description
   ```
4. Confirm the branch is checked out and tell the user work mode is set — commits
   will be tagged `[TICKET-ID]` automatically by the hook.

From here the [git skill](../git/SKILL.md) owns commit messages and the PR.

## Guardrails

- **Confirm before creating a Jira ticket** (show the draft, wait for yes).
- **Confirm an existing ticket exists** before branching on it.
- **Never invent a ticket number.** If you can't fetch or create a real one, stop.
- **An all-zero ticket is banned** — the hooks reject it.
- **Don't switch branches over a dirty tree** without telling the user first.
