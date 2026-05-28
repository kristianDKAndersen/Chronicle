// chronicle/lib/chronicle-vault.js — note CRUD, YAML frontmatter, SQLite FTS5 index.
// Runtime: Bun (bun:sqlite). Vault root: ~/.claude/vault/ (overridable via CHRONICLE_VAULT).
// Per-project root: ~/.claude/vault/projects/<slug>/ via CHRONICLE_PROJECT_SLUG or vaultRoot(slug).
// DB: <vault-root>/.cache/vault.db

import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function vaultRoot(projectSlug) {
  const slug = projectSlug || process.env.CHRONICLE_PROJECT_SLUG;
  if (slug) {
    return path.join(os.homedir(), '.claude', 'vault', 'projects', slug);
  }
  return process.env.CHRONICLE_VAULT || path.join(os.homedir(), '.claude', 'vault');
}
function dbPath() { return path.join(vaultRoot(), '.cache', 'vault.db'); }

// ── Lazy SQLite init ────────────────────────────────────────────────────────
let _db = null;
let _dbPath = null;
function db() {
  const currentPath = dbPath();
  if (_db && _dbPath === currentPath) return _db;
  if (_db && _dbPath !== currentPath) { try { _db.close(); } catch (_) {} _db = null; }
  _dbPath = currentPath;
  fs.mkdirSync(path.dirname(currentPath), { recursive: true });
  _db = new Database(currentPath);
  _db.exec('PRAGMA journal_mode=WAL');
  _db.exec('PRAGMA busy_timeout=10000');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      path TEXT PRIMARY KEY,
      type TEXT, sid TEXT, seq INTEGER, agent TEXT, repo TEXT, project TEXT,
      created_at TEXT, material TEXT, next_action TEXT,
      established TEXT, gap TEXT, plan_ref TEXT, body TEXT,
      archived_at TEXT, archived BOOLEAN DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts
      USING fts5(path UNINDEXED, body, content='notes', content_rowid='rowid');
    CREATE TABLE IF NOT EXISTS links (
      source TEXT, target TEXT,
      kind TEXT DEFAULT 'wikilink',
      confidence TEXT DEFAULT 'EXTRACTED',
      PRIMARY KEY (source, target)
    );
  `);
  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, path, body) VALUES (new.rowid, new.path, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, path, body) VALUES('delete', old.rowid, old.path, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, path, body) VALUES('delete', old.rowid, old.path, old.body);
      INSERT INTO notes_fts(rowid, path, body) VALUES (new.rowid, new.path, new.body);
    END;
  `);
  // migrate: add columns if schema predates them
  const cols = _db.prepare(`PRAGMA table_info(notes)`).all().map(r => r.name);
  if (!cols.includes('due_date')) {
    _db.exec(`ALTER TABLE notes ADD COLUMN due_date TEXT`);
  }
  const bitemporalCols = ['fetched_at', 'published_at', 'content_hash', 't_valid', 't_invalid'];
  for (const col of bitemporalCols) {
    if (!cols.includes(col)) {
      try { _db.exec(`ALTER TABLE notes ADD COLUMN ${col} TEXT`); } catch (_) {}
    }
  }
  if (!cols.includes('task_hash')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN task_hash TEXT`); } catch (_) {}
  }
  if (!cols.includes('worker_verdict')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN worker_verdict TEXT`); } catch (_) {}
  }
  if (!cols.includes('status')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN status TEXT`); } catch (_) {}
  }
  if (!cols.includes('archived_at')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN archived_at TEXT`); } catch (_) {}
  }
  if (!cols.includes('archived')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN archived BOOLEAN DEFAULT 0`); } catch (_) {}
  }
  if (!cols.includes('project')) {
    try { _db.exec(`ALTER TABLE notes ADD COLUMN project TEXT`); } catch (_) {}
  }
  // migrate: embeddings table
  const embTables = _db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'`).all();
  if (!embTables.length) {
    _db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
      path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      computed_at INTEGER NOT NULL
    )`);
  }
  // migrate links: add kind/confidence if schema predates them
  const linkCols = _db.prepare(`PRAGMA table_info(links)`).all().map(r => r.name);
  if (!linkCols.includes('kind')) {
    try { _db.exec(`ALTER TABLE links ADD COLUMN kind TEXT DEFAULT 'wikilink'`); } catch (_) {}
  }
  if (!linkCols.includes('confidence')) {
    try { _db.exec(`ALTER TABLE links ADD COLUMN confidence TEXT DEFAULT 'EXTRACTED'`); } catch (_) {}
  }
  // Q3: integrity check — warn but continue
  try {
    const ic = _db.prepare('PRAGMA integrity_check(1)').get();
    const icVal = ic ? Object.values(ic)[0] : null;
    if (icVal !== 'ok') {
      process.stderr.write(`WARN chronicle-vault: integrity_check returned: ${icVal}\n`);
    }
  } catch (_) {}
  return _db;
}

// ── Frontmatter helpers ─────────────────────────────────────────────────────
export function parseFrontmatter(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.startsWith('---\n')) return { fm: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return { fm: {}, body: text };
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) continue;
    fm[key] = line.slice(colon + 1).trim();
  }
  return { fm, body: text.slice(end + 5) };
}

export function serializeFrontmatter(fm, body) {
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${lines}\n---\n\n${body}`;
}

// ── Note CRUD ───────────────────────────────────────────────────────────────
export function writeNote(relPath, fm, body) {
  const abs = path.join(vaultRoot(), relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeFrontmatter(fm, body));
  _upsertIndex(relPath, fm, body);
}

export function readNote(relPath) {
  const abs = path.join(vaultRoot(), relPath);
  if (!fs.existsSync(abs)) return null;
  return parseFrontmatter(fs.readFileSync(abs, 'utf8'));
}

export function rebuildIndex() {
  const targetDbPath = dbPath();
  let savedEmbeddings = [];
  try {
    if (_db && _dbPath === targetDbPath) {
      savedEmbeddings = _db.prepare(`SELECT path,content_hash,vector,computed_at FROM embeddings`).all();
    } else if (fs.existsSync(targetDbPath)) {
      const tmp = new Database(targetDbPath);
      savedEmbeddings = tmp.prepare(`SELECT path,content_hash,vector,computed_at FROM embeddings`).all();
      tmp.close();
    }
  } catch (_) {}

  if (_db) { try { _db.close(); } catch (_) {} _db = null; }
  const base = dbPath();
  for (const ext of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(base + ext)) fs.unlinkSync(base + ext); } catch (_) {}
  }
  let indexed = 0;
  const root = vaultRoot();
  const cacheDir = path.join(root, '.cache');

  const knownBasenames = new Set();
  function scanBasenames(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== cacheDir) scanBasenames(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        knownBasenames.add(entry.name.slice(0, -3));
      }
    }
  }
  scanBasenames(root);

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== cacheDir) walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = path.relative(root, full);
        try {
          const text = fs.readFileSync(full, 'utf8');
          const { fm, body } = parseFrontmatter(text);
          _upsertIndex(rel, fm, body, knownBasenames);
          indexed++;
        } catch (_) {}
      }
    }
  }
  walk(root);

  if (savedEmbeddings.length) {
    try {
      const d = db();
      const ins = d.prepare(`INSERT OR IGNORE INTO embeddings (path,content_hash,vector,computed_at) VALUES (?,?,?,?)`);
      d.transaction(() => { for (const e of savedEmbeddings) ins.run(e.path, e.content_hash, e.vector, e.computed_at); })();
    } catch (_) {}
  }

  let commResult = null;
  try {
    const linkCount = db().prepare(`SELECT COUNT(*) AS cnt FROM links`).get().cnt;
    if (linkCount > 10) commResult = computeCommunities();
  } catch (_) {}

  return { indexed, communities: commResult };
}

export function deleteNote(relPath) {
  const abs = path.join(vaultRoot(), relPath);
  if (!fs.existsSync(abs)) return { deleted: false };
  fs.unlinkSync(abs);
  try {
    const d = db();
    d.prepare(`DELETE FROM notes WHERE path = ?`).run(relPath);
    d.prepare(`DELETE FROM links WHERE source = ? OR target = ?`).run(relPath, relPath);
  } catch (_) {}
  return { deleted: true };
}

export function previewDeleteNote(relPath) {
  const abs = path.join(vaultRoot(), relPath);
  try {
    const links = db().prepare(`SELECT source, target FROM links WHERE source = ? OR target = ?`).all(relPath, relPath);
    return { absPath: abs, exists: fs.existsSync(abs), links };
  } catch (_) { return { absPath: abs, exists: fs.existsSync(abs), links: [] }; }
}

export function pruneFixtures({ dryRun = false, minBodyLength = 20 } = {}) {
  const fixturePrefix = /^(verdict-test-|test-checkpoint-|test-)/;
  const d = db();
  const allNotes = d.prepare(`SELECT path, body FROM notes`).all();
  const toDelete = [];
  for (const note of allNotes) {
    const baseName = path.basename(note.path);
    const isFixture = fixturePrefix.test(baseName);
    const bodyLen = (note.body || '').trim().length;
    const isShort = bodyLen < minBodyLength;
    if (isFixture || isShort) {
      toDelete.push({ path: note.path, reason: isFixture ? 'prefix-match' : 'short-body', preview: (note.body || '').slice(0, 60) });
    }
  }
  if (!dryRun) {
    const delNote = d.prepare(`DELETE FROM notes WHERE path = ?`);
    const delLinks = d.prepare(`DELETE FROM links WHERE source = ? OR target = ?`);
    const delEmb = d.prepare(`DELETE FROM embeddings WHERE path = ?`);
    for (const note of toDelete) {
      const abs = path.join(vaultRoot(), note.path);
      if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch (_) {} }
      delNote.run(note.path);
      delLinks.run(note.path, note.path);
      delEmb.run(note.path);
    }
  }
  return { count: toDelete.length, pruned: toDelete };
}

export function _upsertIndex(relPath, fm, body, knownBasenames = null) {
  try {
    const d = db();
    d.prepare(`
      INSERT INTO notes (path, type, sid, seq, agent, repo, project, created_at,
                         material, next_action, established, gap, plan_ref, body, due_date,
                         fetched_at, published_at, content_hash, t_valid, t_invalid, task_hash,
                         status, archived_at, archived)
      VALUES ($path,$type,$sid,$seq,$agent,$repo,$project,$created_at,
              $material,$next_action,$established,$gap,$plan_ref,$body,$due_date,
              $fetched_at,$published_at,$content_hash,$t_valid,$t_invalid,$task_hash,
              $status,$archived_at,$archived)
      ON CONFLICT(path) DO UPDATE SET
        type=excluded.type, sid=excluded.sid, seq=excluded.seq,
        agent=excluded.agent, repo=excluded.repo, project=excluded.project,
        created_at=excluded.created_at, material=excluded.material,
        next_action=excluded.next_action, established=excluded.established,
        gap=excluded.gap, plan_ref=excluded.plan_ref, body=excluded.body,
        due_date=excluded.due_date,
        fetched_at=excluded.fetched_at, published_at=excluded.published_at,
        content_hash=excluded.content_hash, t_valid=excluded.t_valid,
        t_invalid=excluded.t_invalid, task_hash=excluded.task_hash,
        status=excluded.status,
        archived_at=excluded.archived_at, archived=excluded.archived
    `).run({
      $path: relPath, $type: fm.type || '', $sid: fm.sid || '',
      $seq: parseInt(fm.seq) || 0, $agent: fm.agent || '',
      $repo: fm.repo || '', $project: fm.project || '',
      $created_at: fm.created_at || '',
      $material: fm.material || '', $next_action: fm.next_action || '',
      $established: fm.established || '', $gap: fm.gap || '',
      $plan_ref: fm.plan_ref || '', $body: body,
      $due_date: fm.due_date || null,
      $fetched_at: fm.fetched_at ?? '', $published_at: fm.published_at ?? '',
      $content_hash: fm.content_hash ?? '', $t_valid: fm.t_valid ?? '',
      $t_invalid: fm.t_invalid ?? '', $task_hash: fm.task_hash ?? '',
      $status: fm.status || null,
      $archived_at: fm.archived_at || null,
      $archived: parseInt(fm.archived) || 0
    });
    // wikilinks
    let bnames = knownBasenames;
    let ghostOk = false;
    if (!bnames) {
      const noteRows = d.prepare(`SELECT path FROM notes`).all();
      bnames = new Set(noteRows.map(r => r.path.replace(/^.*\//, '').replace(/\.md$/, '')));
      bnames.add(relPath.replace(/^.*\//, '').replace(/\.md$/, ''));
      ghostOk = true;
    }
    const targets = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim());
    const del = d.prepare(`DELETE FROM links WHERE source = ?`);
    const ins = d.prepare(`INSERT OR IGNORE INTO links (source, target, kind, confidence) VALUES (?,?,'wikilink','EXTRACTED')`);
    d.transaction(() => {
      del.run(relPath);
      for (const t of targets) {
        if (_isValidLinkTarget(t, bnames, ghostOk)) ins.run(relPath, t);
      }
    })();
  } catch (_) { /* index is advisory; note write already succeeded */ }
}

// ── Link target validation ───────────────────────────────────────────────────
const SID_RE = /\b(?:17[0-9]{8}|[0-9]{10})-[0-9a-f]{6}\b/g;
const _SID_EXACT     = /^(?:17[0-9]{8}|[0-9]{10})-[0-9a-f]{6}$/;
const _SID_SEQ_EXACT = /^(?:17[0-9]{8}|[0-9]{10})-[0-9a-f]{6}-\d+$/;
const _SLUG_RE       = /^[a-z0-9][a-z0-9._\-\/]*$/i;
function _isValidLinkTarget(t, knownBasenames, allowGhost) {
  if (!t) return false;
  if (t.startsWith('http://') || t.startsWith('https://')) return true;
  if (_SID_EXACT.test(t) || _SID_SEQ_EXACT.test(t)) return true;
  const bn = t.replace(/^.*\//, '').replace(/\.md$/, '');
  if (knownBasenames.has(bn) || knownBasenames.has(t)) return true;
  return allowGhost === true && _SLUG_RE.test(t);
}
function extractSids(text) {
  return [...(text || '').matchAll(SID_RE)].map(m => m[0]);
}

// ── High-level writers ───────────────────────────────────────────────────────

export function writeSessionNote(meta) {
  const rel = `sessions/${meta.sid}.md`;
  const body = meta.summary ? `## Summary\n${meta.summary}` : '';
  writeNote(rel, {
    type: 'session',
    sid: meta.sid,
    agent: meta.agent || '',
    project: meta.project || '',
    created_at: meta.created_at || new Date().toISOString()
  }, body);
}

// ── Query (BM25 FTS5) ────────────────────────────────────────────────────────

function _escapeQuery(text) {
  return text.split(/\s+/).map(token => {
    if (!token.includes('-') || token.startsWith('"')) return token;
    return `"${token}"`;
  }).join(' ');
}

export function searchNotes(text, limit = 10, { includeArchived = false } = {}) {
  try {
    const archFilter = includeArchived
      ? ''
      : `AND (n.status IS NULL OR n.status != 'archived')`;
    return db().prepare(`
      SELECT n.path, n.sid, n.type, n.created_at, n.material,
             snippet(notes_fts, 1, '<b>', '</b>', '…', 20) AS snippet
      FROM notes_fts f JOIN notes n ON n.path = f.path
      WHERE notes_fts MATCH ? ${archFilter} ORDER BY rank LIMIT ?
    `).all(_escapeQuery(text), limit);
  } catch (_) { return []; }
}

export function backlinks(noteName) {
  try {
    return db().prepare(`SELECT source FROM links WHERE target = ?`).all(noteName).map(r => r.source);
  } catch (_) { return []; }
}

export const DISMISSED_STATUSES = ['done', 'archived'];
const _DISMISSED_SQL = DISMISSED_STATUSES.map(s => `'${s}'`).join(',');

export function listDue(today = new Date().toISOString().slice(0, 10), windowDays = 14) {
  try {
    const [y, m, dd] = today.split('-').map(Number);
    const t = Date.UTC(y, m - 1, dd) + windowDays * 86400000;
    const windowEnd = new Date(t).toISOString().slice(0, 10);
    return db().prepare(`
      SELECT path, type, created_at, established, body, due_date
      FROM notes
      WHERE due_date IS NOT NULL AND due_date <= ?
            AND (status IS NULL OR status NOT IN (${_DISMISSED_SQL}))
      ORDER BY due_date ASC
    `).all(windowEnd);
  } catch (_) { return []; }
}

export function listUnresolved() {
  try {
    return db().prepare(`
      SELECT source, target FROM links
      WHERE target NOT IN (
        SELECT REPLACE(path, '.md', '') FROM notes
        UNION
        SELECT REPLACE(SUBSTR(path, INSTR(path,'/')+1), '.md', '') FROM notes WHERE path LIKE '%/%'
      )
    `).all();
  } catch (_) { return []; }
}

export function neighbors(noteName, depth = 1) {
  try {
    const d = db();
    const out = d.prepare(`
      SELECT target AS note, kind, confidence, 'out' AS direction FROM links
      WHERE source = ? OR source = ? || '.md' OR source LIKE '%/' || ? || '.md'
    `).all(noteName, noteName, noteName);
    const bn = noteName.replace(/^.*\//, '').replace(/\.md$/, '');
    const inc = d.prepare(`
      SELECT source AS note, kind, confidence, 'in' AS direction FROM links
      WHERE target = ? OR target = ?
    `).all(noteName, bn);
    const seen = new Set();
    return [...out, ...inc].filter(r => {
      const k = r.direction + ':' + r.note;
      return seen.has(k) ? false : (seen.add(k), true);
    });
  } catch (_) { return []; }
}

export function shortestPath(from, to) {
  if (from === to) return [from];
  try {
    const rows = db().prepare(`
      WITH RECURSIVE path(node, route, visited, depth) AS (
        SELECT ?1, ?1, '|' || ?1 || '|', 0
        UNION ALL
        SELECT l.target,
               path.route || ' -> ' || l.target,
               path.visited || l.target || '|',
               path.depth + 1
        FROM links l
        JOIN path ON (
          l.source = path.node
          OR l.source = path.node || '.md'
          OR l.source LIKE '%/' || path.node || '.md'
        )
        WHERE path.depth < 10
          AND path.visited NOT LIKE '%|' || l.target || '|%'
      )
      SELECT route FROM path WHERE node = ?2 LIMIT 1
    `).all(from, to);
    if (!rows.length) return [];
    return rows[0].route.split(' -> ');
  } catch (_) { return []; }
}

export function listHubs(limit = 20) {
  try {
    return db().prepare(`
      SELECT target, COUNT(*) AS deg FROM links GROUP BY target ORDER BY deg DESC LIMIT ?
    `).all(limit);
  } catch (_) { return []; }
}

export function listGaps(limit = 20) {
  try {
    return db().prepare(`
      SELECT path, sid, created_at, established, gap
      FROM notes
      WHERE worker_verdict = 'blocked'
        AND type = 'synthesis'
        AND sid NOT IN (SELECT sid FROM notes WHERE type = 'lesson')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
  } catch (_) { return []; }
}

export function setWorkerVerdict(relPath, verdict) {
  try {
    db().prepare(`UPDATE notes SET worker_verdict = ? WHERE path = ?`).run(verdict, relPath);
  } catch (_) {}
}

function _assertSingleLineFrontmatter(relPath) {
  const abs = path.join(vaultRoot(), relPath);
  if (!fs.existsSync(abs)) return;
  const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.startsWith('---\n')) return;
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return;
  for (const line of text.slice(4, end).split('\n')) {
    if (line === '') continue;
    if (/^\s/.test(line) || line.indexOf(':') === -1) {
      throw new Error(`multi-line frontmatter not supported — ${relPath} has continuation lines`);
    }
  }
}

export function setStatus(relPath, status) {
  const note = readNote(relPath);
  if (!note) return;
  _assertSingleLineFrontmatter(relPath);
  writeNote(relPath, { ...note.fm, status }, note.body);
  try { db().prepare(`UPDATE notes SET status = ? WHERE path = ?`).run(status, relPath); } catch (_) {}
}

export function setDueDate(relPath, isoDate) {
  const note = readNote(relPath);
  if (!note) return;
  _assertSingleLineFrontmatter(relPath);
  writeNote(relPath, { ...note.fm, due_date: isoDate }, note.body);
}

// ── Growth management ────────────────────────────────────────────────────────

export function countNotes() {
  try {
    return db().prepare('SELECT COUNT(*) AS cnt FROM notes').get().cnt;
  } catch (_) { return 0; }
}

export async function archiveNotes({ olderThanDays = 180, dryRun = false } = {}) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  const d = db();
  const candidates = d.prepare(`
    SELECT path FROM notes
    WHERE (status IS NULL OR status = '') AND type = 'session' AND created_at < ?
  `).all(cutoff);
  if (!dryRun) {
    const root = vaultRoot();
    const archiveDir = path.join(root, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const now = new Date().toISOString();
    for (const row of candidates) {
      const abs = path.join(root, row.path);
      const dest = path.join(archiveDir, path.basename(row.path));
      try { if (fs.existsSync(abs)) fs.renameSync(abs, dest); } catch (_) {}
      try {
        d.prepare(`UPDATE notes SET status = 'archived', archived_at = ?, archived = 1 WHERE path = ?`)
          .run(now, row.path);
      } catch (_) {}
    }
  }
  return { archived: candidates.length, dryRun };
}

// ── Phase 5: Retroactive Related-section rewrite ─────────────────────────────

export function retroLink(opts = {}) {
  const { dryRun = false, limit = 0 } = opts;
  const root = vaultRoot();
  const d = db();

  let rows = d.prepare(`
    SELECT path, type, sid, body FROM notes
    WHERE type IN ('synthesis','session','lesson','project')
  `).all();

  if (limit > 0) rows = rows.slice(0, limit);

  let candidates = 0, rewritten = 0, skippedNoSids = 0, skippedHasSection = 0;

  for (const row of rows) {
    candidates++;
    const abs = path.join(root, row.path);
    if (!fs.existsSync(abs)) continue;

    const rawText = fs.readFileSync(abs, 'utf8');
    const { fm, body } = parseFrontmatter(rawText);

    if (body.includes('## Related')) { skippedHasSection++; continue; }

    const sids = [...new Set(extractSids(body + ' ' + (fm.sid || '')))].filter(Boolean);
    if (!sids.length) { skippedNoSids++; continue; }

    if (!dryRun) {
      const relatedSection = `\n\n## Related\n${sids.map(s => `[[${s}]]`).join(' ')}`;
      fs.writeFileSync(abs, rawText.trimEnd() + relatedSection);
    }
    rewritten++;
  }

  if (!dryRun) rebuildIndex();

  return { candidates, rewritten, skippedNoSids, skippedHasSection };
}

// ── Phase 5: Community detection (Louvain) ───────────────────────────────────

function _louvain(nodes, adj) {
  let totalW = 0;
  for (const nb of adj.values()) for (const w of nb.values()) totalW += w;
  const m = totalW / 2;
  if (m === 0) { const c = new Map(); nodes.forEach((n, i) => c.set(n, i)); return c; }

  const degree = n => { let s = 0; for (const w of (adj.get(n)?.values() || [])) s += w; return s; };
  const comm = new Map();
  nodes.forEach((n, i) => comm.set(n, i));

  let improved = true;
  let itr = 0;
  while (improved && itr++ < 200) {
    improved = false;
    for (const node of nodes) {
      const curComm = comm.get(node);
      const k_i = degree(node);

      const sumTot = new Map();
      for (const [n, c] of comm) {
        if (n === node) continue;
        sumTot.set(c, (sumTot.get(c) || 0) + degree(n));
      }

      const kToComm = new Map();
      for (const [nb, w] of (adj.get(node) || new Map())) {
        const c = comm.get(nb);
        if (c !== undefined) kToComm.set(c, (kToComm.get(c) || 0) + w);
      }

      let bestGain = -Infinity;
      let bestComm = curComm;
      for (const c of new Set([curComm, ...kToComm.keys()])) {
        const k_in = kToComm.get(c) || 0;
        const s_tot = sumTot.get(c) || 0;
        const dQ = k_in / m - s_tot * k_i / (2 * m * m);
        if (dQ > bestGain) { bestGain = dQ; bestComm = c; }
      }

      if (bestComm !== curComm) { comm.set(node, bestComm); improved = true; }
    }
  }

  const idMap = new Map(); let nextId = 0;
  const normalized = new Map();
  for (const [n, c] of comm) {
    if (!idMap.has(c)) idMap.set(c, nextId++);
    normalized.set(n, idMap.get(c));
  }
  return normalized;
}

export function computeCommunities(opts = {}) {
  const d = db();

  const tables = d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='communities'`).all();
  if (!tables.length) {
    d.exec(`CREATE TABLE IF NOT EXISTS communities (
      id INTEGER PRIMARY KEY,
      node TEXT NOT NULL,
      community_id INTEGER NOT NULL,
      computed_at INTEGER NOT NULL
    )`);
  }

  const linkRows = d.prepare(`SELECT source, target FROM links`).all();

  const bn = s => s.replace(/^.*\//, '').replace(/\.md$/, '');

  const adj = new Map();
  const nodeSet = new Set();
  const seenEdges = new Set();
  for (const row of linkRows) {
    const src = bn(row.source);
    const tgt = bn(row.target);
    if (src === tgt || !src || !tgt) continue;
    const edgeKey = src < tgt ? `${src}|${tgt}` : `${tgt}|${src}`;
    if (seenEdges.has(edgeKey)) { nodeSet.add(src); nodeSet.add(tgt); continue; }
    seenEdges.add(edgeKey);
    nodeSet.add(src); nodeSet.add(tgt);
    if (!adj.has(src)) adj.set(src, new Map());
    if (!adj.has(tgt)) adj.set(tgt, new Map());
    adj.get(src).set(tgt, 1);
    adj.get(tgt).set(src, 1);
  }

  const nodes = [...nodeSet];
  if (!nodes.length) return { communities: 0, nodes: 0, modularity: 0 };

  const commMap = _louvain(nodes, adj);

  const m = seenEdges.size;
  const degree = n => { let s = 0; for (const w of (adj.get(n)?.values() || [])) s += w; return s; };
  const commEdges = new Map(); const commDegSum = new Map();
  for (const node of nodes) {
    const c = commMap.get(node);
    commDegSum.set(c, (commDegSum.get(c) || 0) + degree(node));
  }
  for (const edgeKey of seenEdges) {
    const [src, tgt] = edgeKey.split('|');
    if (commMap.get(src) === commMap.get(tgt)) {
      const c = commMap.get(src);
      commEdges.set(c, (commEdges.get(c) || 0) + 1);
    }
  }
  let Q = 0;
  for (const [c, a_c] of commDegSum) {
    const e_c = commEdges.get(c) || 0;
    Q += (m > 0 ? e_c / m : 0) - Math.pow(a_c / (2 * m), 2);
  }
  Q = Math.round(Q * 1000) / 1000;

  const now = Math.floor(Date.now() / 1000);
  d.exec(`DELETE FROM communities`);
  const ins = d.prepare(`INSERT INTO communities (node, community_id, computed_at) VALUES (?, ?, ?)`);
  d.transaction(() => { for (const [node, cid] of commMap) ins.run(node, cid, now); })();

  return { communities: new Set(commMap.values()).size, nodes: nodes.length, modularity: Q };
}

export function listCommunities(limit = 20) {
  try {
    const d = db();
    const rows = d.prepare(`
      SELECT community_id, COUNT(*) AS size, GROUP_CONCAT(node, ', ') AS members
      FROM communities
      GROUP BY community_id
      ORDER BY size DESC
      LIMIT ?
    `).all(limit);

    if (!rows.length) return [];

    const allNodeSet = new Set();
    for (const r of rows) {
      for (const n of (r.members || '').split(', ')) if (n) allNodeSet.add(n);
    }

    const notesByBasename = new Map();
    const allNoteRows = d.prepare(`SELECT path, established, created_at FROM notes`).all();
    for (const note of allNoteRows) {
      const bn = note.path.replace(/^.*\//, '').replace(/\.md$/, '');
      if (allNodeSet.has(bn) && !notesByBasename.has(bn)) notesByBasename.set(bn, note);
    }

    const linkRows = d.prepare(`SELECT source, target FROM links`).all();
    const bnOf = s => s.replace(/^.*\//, '').replace(/\.md$/, '');

    const commNodeSets = new Map();
    for (const r of rows) {
      const members = (r.members || '').split(', ').filter(Boolean);
      commNodeSets.set(r.community_id, new Set(members));
    }

    const intraCounts = new Map();
    for (const r of rows) intraCounts.set(r.community_id, 0);
    for (const link of linkRows) {
      const s = bnOf(link.source), t = bnOf(link.target);
      if (s === t) continue;
      for (const [cid, nodeSet] of commNodeSets) {
        if (nodeSet.has(s) && nodeSet.has(t)) {
          intraCounts.set(cid, (intraCounts.get(cid) || 0) + 1);
        }
      }
    }

    return rows.map(r => {
      const members = (r.members || '').split(', ').filter(Boolean);

      const representative_titles = members.slice(0, 3).map(node => {
        const note = notesByBasename.get(node);
        if (!note) return null;
        return ((note.established || note.path) + '').slice(0, 80) || null;
      });

      let minCa = null, maxCa = null;
      for (const node of members) {
        const note = notesByBasename.get(node);
        if (note && note.created_at) {
          if (!minCa || note.created_at < minCa) minCa = note.created_at;
          if (!maxCa || note.created_at > maxCa) maxCa = note.created_at;
        }
      }

      const intraEdges = intraCounts.get(r.community_id) || 0;
      const maxEdges = members.length * (members.length - 1);
      const edge_density = maxEdges > 0 ? Math.round((intraEdges / maxEdges) * 1000) / 1000 : 0;

      return {
        community_id: r.community_id,
        size: r.size,
        members,
        representative_titles,
        time_range: { min: minCa, max: maxCa },
        edge_density
      };
    });
  } catch (_) { return []; }
}

// ── Phase 7: Local semantic embedding ────────────────────────────────────────

function _cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function embedNotes({ limit = 0, threshold = 0.97, topK = 5, force = false, onlyChanged = false, dryRun = false, _pipelineFactory = null } = {}) {
  const d = db();

  let rows = d.prepare(`
    SELECT path, body FROM notes
    WHERE type IN ('synthesis','session','lesson','project')
  `).all();
  if (limit > 0) rows = rows.slice(0, limit);

  let pipe;
  if (_pipelineFactory) {
    pipe = _pipelineFactory();
  } else {
    const mod = await import('@xenova/transformers');
    const { pipeline } = mod.default || mod;
    pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  let embedded = 0, skipped_hash = 0;

  for (const row of rows) {
    const normalized = (row.body || '').replace(/\s+/g, ' ').trim();
    const hash = createHash('sha256').update(normalized).digest('hex');

    if (!force) {
      const existing = d.prepare(`SELECT content_hash FROM embeddings WHERE path = ?`).get(row.path);
      if (existing && existing.content_hash === hash) { skipped_hash++; continue; }
    }

    const output = await pipe(normalized);
    const f32 = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    const vec = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);

    d.prepare(`
      INSERT INTO embeddings (path, content_hash, vector, computed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        content_hash=excluded.content_hash, vector=excluded.vector, computed_at=excluded.computed_at
    `).run(row.path, hash, vec, Math.floor(Date.now() / 1000));
    embedded++;
  }

  const allEmbs = d.prepare(`SELECT path, vector FROM embeddings`).all();
  const vecList = allEmbs.map(r => {
    const buf = r.vector;
    return { path: r.path, vec: new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)) };
  });

  const topNeighbors = new Map();
  const histogram = dryRun
    ? { '0.5-0.6': 0, '0.6-0.7': 0, '0.7-0.8': 0, '0.8-0.9': 0, '0.9-0.95': 0, '0.95-1.0': 0 }
    : null;

  for (let i = 0; i < vecList.length; i++) {
    const { path: pi, vec: vi } = vecList[i];
    const eligible = [];
    for (let j = 0; j < vecList.length; j++) {
      if (i === j) continue;
      const sim = _cosine(vi, vecList[j].vec);
      if (histogram && j > i && sim >= 0.5) {
        if (sim < 0.6)       histogram['0.5-0.6']++;
        else if (sim < 0.7)  histogram['0.6-0.7']++;
        else if (sim < 0.8)  histogram['0.7-0.8']++;
        else if (sim < 0.9)  histogram['0.8-0.9']++;
        else if (sim < 0.95) histogram['0.9-0.95']++;
        else                 histogram['0.95-1.0']++;
      }
      if (sim >= threshold) eligible.push({ sim, path: vecList[j].path });
    }
    eligible.sort((a, b) => b.sim - a.sim);
    topNeighbors.set(pi, topK > 0 ? eligible.slice(0, topK) : eligible);
  }

  const nominations = new Set();
  for (const [pi, neighbors] of topNeighbors) {
    for (const { path: pj } of neighbors) {
      const key = pi < pj ? `${pi}\x00${pj}` : `${pj}\x00${pi}`;
      nominations.add(key);
    }
  }

  let semantic_links_added = 0, semantic_links_skipped_existing = 0;

  if (dryRun) {
    for (const key of nominations) {
      const sep = key.indexOf('\x00');
      const path_a = key.slice(0, sep);
      const path_b = key.slice(sep + 1);
      const target_b = path_b.replace(/^.*\//, '').replace(/\.md$/, '');
      const target_a = path_a.replace(/^.*\//, '').replace(/\.md$/, '');
      const exists = d.prepare(`
        SELECT 1 FROM links
        WHERE (source=? AND target=?) OR (source=? AND target=?)
           OR (source=? AND target=?) OR (source=? AND target=?)
        LIMIT 1
      `).get(path_a, target_b, path_b, target_a, path_a, path_b, path_b, path_a);
      if (exists) semantic_links_skipped_existing++;
      else semantic_links_added++;
    }
    return {
      dry_run: true,
      histogram,
      edges_would_insert: semantic_links_added,
      embedded,
      skipped_hash,
      semantic_links_skipped_existing,
    };
  }

  for (const key of nominations) {
    const sep = key.indexOf('\x00');
    const path_a = key.slice(0, sep);
    const path_b = key.slice(sep + 1);
    const target_b = path_b.replace(/^.*\//, '').replace(/\.md$/, '');
    const target_a = path_a.replace(/^.*\//, '').replace(/\.md$/, '');
    const exists = d.prepare(`
      SELECT 1 FROM links
      WHERE (source=? AND target=?) OR (source=? AND target=?)
         OR (source=? AND target=?) OR (source=? AND target=?)
      LIMIT 1
    `).get(path_a, target_b, path_b, target_a, path_a, path_b, path_b, path_a);
    if (exists) { semantic_links_skipped_existing++; continue; }
    d.prepare(`INSERT OR IGNORE INTO links (source,target,kind,confidence) VALUES (?,?,'semantic','INFERRED')`).run(path_a, target_b);
    semantic_links_added++;
  }

  return { embedded, skipped_hash, semantic_links_added, semantic_links_skipped_existing };
}
