// build-lesson-candidate.js — construct a meaningful lesson note from the
// PostToolUseFailure hook payload (the failed tool call + its error output).
// Runtime: Bun. Invoked by lesson-candidate.sh.
//
// Inputs (env):
//   CHRONICLE_HOOK_INPUT  raw PostToolUseFailure stdin JSON
//                         ({ session_id, cwd, tool_name, tool_input, tool_response, ... })
//   CHRONICLE_SLUG        resolved project slug (for the `project` frontmatter)
//   CHRONICLE_CREATED_AT  ISO timestamp for this write
// Vault location comes from CHRONICLE_VAULT (exported by lib-options.sh).

import { writeNote } from '../lib/chronicle-vault.js';

function clean(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function truncate(s, n) {
  const c = clean(s);
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
}
function stringify(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const raw = process.env.CHRONICLE_HOOK_INPUT || '';
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  // non-JSON stdin → minimal note
}

const sessionId = payload.session_id || process.env.CHRONICLE_SESSION_ID || 'unknown';
const project = process.env.CHRONICLE_SLUG || 'unknown';
const nowIso = process.env.CHRONICLE_CREATED_AT || new Date().toISOString();
const toolName = payload.tool_name || 'unknown tool';
const input = payload.tool_input || {};
const resp = payload.tool_response;

// Best-effort: pull the most useful "what failed" and "why" fields across tools.
const action =
  input.command || input.file_path || input.notebook_path || input.url || stringify(input);
let errText = '';
if (resp && typeof resp === 'object') {
  errText = resp.error || resp.stderr || resp.stdout || resp.message || stringify(resp);
} else {
  errText = stringify(resp);
}

const safeStamp = nowIso.replace(/[:TZ]/g, '-');
const relPath = `lessons/lesson-${safeStamp}.md`;

const out = [];
out.push(`# Lesson candidate — ${clean(toolName)} failed`);
out.push('');
if (action) out.push(`**Action:** \`${truncate(action, 200)}\``);
out.push('');
if (errText) {
  out.push('## Error');
  out.push('```');
  out.push(truncate(errText, 800));
  out.push('```');
  out.push('');
}
out.push('_Auto-captured from a tool failure. Promote to a durable lesson if the cause is worth remembering._');
const body = out.join('\n').trim() + '\n';

writeNote(
  relPath,
  {
    type: 'lesson',
    session_id: sessionId,
    project,
    agent: 'claude',
    created_at: nowIso,
    status: 'candidate',
    tool: clean(toolName),
  },
  body,
);
process.stderr.write(`chronicle: lesson candidate written: ${relPath}\n`);
