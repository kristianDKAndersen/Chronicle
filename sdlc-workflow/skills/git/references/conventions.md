# Git conventions — full reference

Expands the summary in `SKILL.md`. These conventions are enforced by the git
hooks installed via `/sdlc-workflow:install-hooks`. The **ticket prefix** is read
from `git config sdlc.ticketPrefix`; `ABC` below stands for that configured key.

## The rules

1. All commits merged to integration branches (`develop` or `main`) must include
   the ticket ID — format `[ABC-123] description`.
2. Branch names must follow `<type>/ABC-123-short-description` — **type prefix
   first, ticket ID second**.
3. Reach integration branches through a pull request (with peer approval where
   your team requires it).
4. No direct commits to `main`.
5. Prefer CI/CD over manual deployments.

> Rules 3–5 are team policy, not git-hook-enforced — the hooks cover the commit
> and branch *format* (1 and 2). Pair the hooks with a CI check for true
> server-side enforcement (any developer can `--no-verify` a local hook).

## Commit message format

| Rule | Detail |
|------|--------|
| Prefix | `[ABC-123]` — square brackets, the project key, a hyphen, digits |
| Separator | A single space after `]`, then the description |
| Description | Imperative, concise; explain *why* in the body when non-obvious |
| Placeholder | An all-zero ticket (`[ABC-0000]`) is **rejected** — it breaks traceability |
| Trailer | Add any co-author/sign-off trailer your environment requires |

Examples:

| Message | Verdict |
|---------|---------|
| `[ABC-123] add co-applicant SSN validation` | ✅ valid |
| `[ABC-2474] bulk user import` | ✅ valid |
| `ABC-123: add validation` | ❌ wrong form (colon, no brackets) |
| `[ABC-0000] wip` | ❌ placeholder banned |
| `fix login bug` | ❌ no ticket |

The hook accepts any digit count, so `[ABC-1]` and `[ABC-12345]` are both valid.
If you want to require a fixed width, tighten the regex in `hooks/git/commit-msg`.

## Branch type prefixes

| Prefix | Use for | Example |
|--------|---------|---------|
| `feature/` | New functionality | `feature/ABC-2474-bulk-user-import` |
| `bugfix/` | Non-production bug fixes | `bugfix/ABC-2251-fix-login-timeout` |
| `hotfix/` | Urgent production fixes | `hotfix/ABC-2447-emergency-rate-limit` |
| `refactor/` | Code restructuring without behaviour change | `refactor/ABC-2123-extract-auth-service` |
| `chore/` | Maintenance, dependency updates, tooling | `chore/ABC-2010-update-dependencies` |
| `incident/` | Emergency production incident patches | `incident/ABC-2392-restore-payment-flow` |

Person-name prefixes (`alex/`, `sam/`, …) are not valid. `epic/` and `story/` are
not approved prefixes and must be replaced with `feature/`.

## Issue type ≠ branch prefix — two separate axes

A Jira project usually exposes only a few issue types (e.g. Task / Bug / Story /
Epic), but the branch vocabulary above is wider and keyed to the *nature of the
work*. So `chore` / `refactor` / `hotfix` / `incident` work has no matching issue
type: create it as a **Task** (or **Bug** for a defect) and carry the intent in
the branch prefix.

| Nature of work | Branch prefix | Typical issue type |
|----------------|---------------|--------------------|
| New functionality | `feature/` | Story or Task |
| Non-production bug fix | `bugfix/` | Bug |
| Urgent production fix | `hotfix/` | Task (or Bug) |
| Restructuring, no behaviour change | `refactor/` | Task |
| Maintenance / deps / tooling | `chore/` | Task |
| Emergency incident patch | `incident/` | Task (or Bug) |

## Configuring for your team

- **Ticket prefix / project key:** `git config sdlc.ticketPrefix ABC` (the install
  step does this from the `jiraProjectKey` user config). With no prefix set, the
  hooks accept any `UPPERCASE-123` ticket.
- **Base branch:** the skills auto-detect `origin/HEAD`, falling back to `main`.
  Override with the `baseBranch` user config.
- **Approved branch types / digit width:** edit `hooks/git/pre-push` and
  `hooks/git/commit-msg` if your team's standard differs.
