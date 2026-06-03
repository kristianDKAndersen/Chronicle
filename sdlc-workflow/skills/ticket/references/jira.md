# Jira & Slack reference — for /sdlc-workflow:ticket

Tool names and argument shapes for the Atlassian and Slack connectors, plus the
runtime-discovery rules that keep this plugin free of any hardcoded org IDs.

## Runtime discovery (no hardcoded IDs)

| Value | How to get it |
|-------|---------------|
| `cloudId` | `jiraCloudId` user config if set; else call `getAccessibleAtlassianResources` and use the returned site `id` (or pass the site host like `yoursite.atlassian.net`). |
| Project key | `jiraProjectKey` user config; else `git config sdlc.ticketPrefix`; else infer from recent branch/commit ticket IDs; else ask. |
| Self (account id) | `atlassianUserInfo` → `account_id`. |
| Base branch | `baseBranch` config; else `git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`. |

All Jira tool calls require `cloudId`. These are claude.ai connectors,
authenticated per-user via `/mcp` — the plugin never ships credentials.

## Atlassian (Rovo) MCP tools

Deferred — load with `ToolSearch` before calling, e.g.
`select:mcp__claude_ai_Atlassian_Rovo__getJiraIssue,mcp__claude_ai_Atlassian_Rovo__createJiraIssue`.
(Tool names may vary by connector version; discover with `ToolSearch` if a
`select:` miss occurs.)

| Need | Tool | Key args |
|------|------|----------|
| List sites / get cloudId | `getAccessibleAtlassianResources` | — |
| Current user (assignee self) | `atlassianUserInfo` | — |
| Fetch an existing ticket (Path 1) | `getJiraIssue` | `cloudId`, `issueIdOrKey` |
| Find a ticket by text/status | `searchJiraIssuesUsingJql` | `cloudId`, `jql` (e.g. `project = ABC AND assignee = currentUser() ORDER BY created DESC`) |
| List a project's issue types | `getJiraProjectIssueTypesMetadata` | `cloudId`, `projectIdOrKey` |
| Create a ticket (Paths 2 & 3) | `createJiraIssue` | `cloudId`, `projectKey`, `issueTypeName`, `summary`, `description`, `contentFormat: "markdown"`, optional `assignee_account_id` |

`createJiraIssue` hard-requires only `cloudId` + `projectKey` + `issueTypeName` +
`summary`. Priority/labels/custom fields go through the `additional_fields` object.

### Sprint vs backlog

`createJiraIssue` has no sprint parameter, so a new ticket lands in the **backlog**
with no sprint — the recommended default (create in backlog, move to a sprint in
Jira when ready). To drop it into the active sprint on explicit request: find the
Sprint custom-field id (via `getJiraIssueTypeMetaWithFields` or by reading an
in-sprint issue) and the active sprint id (`searchJiraIssuesUsingJql` with
`sprint in openSprints()`), then pass `additional_fields: { "customfield_XXXXX": <sprintId> }`.

## Slack MCP tools

The Slack connector is auth-gated. If `ToolSearch` surfaces only an
`authenticate` stub, Slack isn't connected — tell the user to authenticate it via
`/mcp` and stop; don't fabricate Slack content. Once connected, the read tools
register (load each with `ToolSearch` `select:` before calling).

| Need | Tool | Key args |
|------|------|----------|
| Read a thread (parent + replies) | `slack_read_thread` | `channel_id` + `message_ts` (parent ts, e.g. `"1700000000.123456"`) |
| Search messages | `slack_search_public_and_private` | `query` (Slack syntax: `in:#chan`, `from:@user`, `is:thread`, `after:YYYY-MM-DD`) |
| Read recent channel messages | `slack_read_channel` | `channel_id` (a user id reads that DM) |
| Resolve a user's display name | `slack_read_user_profile` | `user_id` (omit = current user) |
| Find a channel id by name | `slack_search_channels` | name query |

**There is no fetch-by-URL tool.** A permalink must be *parsed* into the two args
`slack_read_thread` needs:

```
https://<workspace>.slack.com/archives/<CHANNEL_ID>/p<DIGITS>[?thread_ts=<PARENT_TS>&cid=...]
                                        └ channel_id    └ ts = insert '.' 6 digits from the end
                                                              p1700000000123456 → 1700000000.123456
```

- `channel_id` = the `archives/<…>` path segment (starts with `C`, or `D` for a DM).
- `message_ts` = the **parent** ts. If the URL has `?thread_ts=`, use that.
  Otherwise convert the `p<DIGITS>` segment by inserting a decimal point 6 digits
  from the right.
- Fallback when there's no link: `slack_search_public_and_private` with keywords
  (+ `in:#channel`, `is:thread`) returns `channel_id` + `ts`.

Resolve author names with `slack_read_user_profile` if a thread shows raw IDs.
Quote the originating ask and include the permalink in the created ticket.
