// build-session-summary.js — construct a meaningful session note from the Stop
// hook's transcript and upsert it (one note per session, refreshed every Stop).
// Runtime: Bun. Invoked by stop-session.sh.
//
// Inputs (env):
//   CHRONICLE_HOOK_INPUT  raw Stop-hook stdin JSON ({ session_id, transcript_path, cwd, ... })
//   CHRONICLE_SLUG        resolved project slug (for the `project` frontmatter)
//   CHRONICLE_CREATED_AT  ISO timestamp for this write
// Vault location comes from CHRONICLE_VAULT (exported by lib-options.sh).

import { writeNote, readNote } from '../lib/chronicle-vault.js';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function truncate(s, n) {
  s = clean(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  }
  return '';
}
// Harness wrappers / injected reminders are not real user prompts.
function isNoise(t) {
  const s = String(t || '').trimStart();
  return (
    !s ||
    s.startsWith('<local-command') ||
    s.startsWith('<command-') ||
    s.startsWith('<system-reminder') ||
    s.startsWith('Caveat:') ||
    s.startsWith('<bash-')
  );
}

const raw = process.env.CHRONICLE_HOOK_INPUT || '';
let payload = {};
try {
  payload = JSON.parse(raw);
} catch {
  // non-JSON stdin → fall back to env-only
}

const sessionId = payload.session_id || process.env.CHRONICLE_SESSION_ID || '';
const transcriptPath = payload.transcript_path || '';
const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const project = process.env.CHRONICLE_SLUG || 'unknown';
const nowIso = process.env.CHRONICLE_CREATED_AT || new Date().toISOString();

if (!sessionId) {
  process.stderr.write('chronicle: no session_id in Stop payload; skipping note\n');
  process.exit(0);
}

const relPath = `sessions/${sessionId}.md`;

let firstPrompt = '';
let lastAssistant = '';
let title = '';
const files = new Set();
const commands = [];
let userTurns = 0;
let toolCalls = 0;

if (transcriptPath && fs.existsSync(transcriptPath)) {
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'ai-title' && e.title) title = e.title;
    const m = e.message;
    if (!m) continue;

    if (e.type === 'user') {
      const hasToolResult =
        Array.isArray(m.content) && m.content.some((b) => b && b.type === 'tool_result');
      const txt = textFromContent(m.content);
      if (txt && !hasToolResult && !isNoise(txt)) {
        userTurns++;
        if (!firstPrompt) firstPrompt = txt;
      }
    } else if (e.type === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text && b.text.trim()) lastAssistant = b.text;
        if (b.type === 'tool_use') {
          toolCalls++;
          const name = b.name;
          const inp = b.input || {};
          if (name === 'Edit' || name === 'Write' || name === 'MultiEdit') {
            if (inp.file_path) files.add(inp.file_path);
          } else if (name === 'NotebookEdit') {
            if (inp.notebook_path) files.add(inp.notebook_path);
          } else if (name === 'Bash') {
            if (inp.command) {
              const first = String(inp.command).split('\n')[0].trim();
              // Skip pure variable assignments (e.g. `REPO=...`) — setup noise, not actions.
              if (first && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) commands.push(first);
            }
          }
        }
      }
    }
  }
}

let branch = '';
try {
  branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  // not a git repo / git unavailable — omit branch
}

// Preserve the original created_at across re-writes; only updated_at moves.
let createdAt = nowIso;
try {
  const existing = readNote(relPath);
  if (existing && existing.fm && existing.fm.created_at) createdAt = existing.fm.created_at;
} catch {
  // no prior note
}

const relOf = (p) => {
  try {
    const r = path.relative(cwd, p);
    return r && !r.startsWith('..') ? r : p;
  } catch {
    return p;
  }
};
const fileList = [...files].map(relOf);
const cmdList = commands.slice(-12);

const out = [];
out.push(title ? `# ${clean(title)}` : `# Session ${sessionId}`);
out.push('');
if (firstPrompt) out.push(`**Asked:** ${truncate(firstPrompt, 300)}`);
if (branch) out.push(`**Branch:** \`${branch}\``);
out.push(`**Activity:** ${userTurns} prompt(s) · ${toolCalls} tool call(s)`);
out.push('');
if (fileList.length) {
  out.push(`## Files touched (${fileList.length})`);
  for (const f of fileList) out.push(`- \`${f}\``);
  out.push('');
}
if (cmdList.length) {
  out.push(`## Commands (${commands.length})`);
  for (const c of cmdList) out.push(`- \`${truncate(c, 120)}\``);
  out.push('');
}
if (lastAssistant) {
  out.push('## Last status');
  out.push(truncate(lastAssistant, 500));
  out.push('');
}
const body = out.join('\n').trim() + '\n';

const fm = {
  type: 'session',
  session_id: sessionId,
  project,
  agent: 'claude',
  created_at: createdAt,
  updated_at: nowIso,
  files_touched: fileList.length,
  tool_calls: toolCalls,
};
if (title) fm.title = clean(title).replace(/\n/g, ' ');

writeNote(relPath, fm, body);
process.stderr.write(
  `chronicle: session note written: ${relPath} (${fileList.length} files, ${toolCalls} tools)\n`,
);
