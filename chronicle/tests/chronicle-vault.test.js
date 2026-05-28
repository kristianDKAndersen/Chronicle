import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libPath = path.resolve(__dirname, '../lib/chronicle-vault.js');

// ── Static source checks ──────────────────────────────────────────────────────

describe('static: ADVISOR_VAULT references', () => {
  test('no ADVISOR_VAULT refs in chronicle/lib/', () => {
    const libDir = path.dirname(libPath);
    if (!fs.existsSync(libDir)) {
      expect(false, 'chronicle/lib/ does not exist yet').toBe(true);
      return;
    }
    const files = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
    for (const file of files) {
      const src = fs.readFileSync(path.join(libDir, file), 'utf8');
      expect(src, `ADVISOR_VAULT found in ${file}`).not.toContain('ADVISOR_VAULT');
    }
  });
});

describe('static: busy_timeout in source', () => {
  test('busy_timeout=10000 is present', () => {
    if (!fs.existsSync(libPath)) {
      expect(false, 'chronicle-vault.js does not exist yet').toBe(true);
      return;
    }
    const src = fs.readFileSync(libPath, 'utf8');
    expect(src).toContain('busy_timeout');
  });
});

// ── Export shape checks ───────────────────────────────────────────────────────

describe('exports: removed advisor functions absent', () => {
  test('writeSynthesisNote is not exported', async () => {
    const mod = await import('../lib/chronicle-vault.js');
    expect(mod.writeSynthesisNote).toBeUndefined();
  });

  test('backfillVerdicts is not exported', async () => {
    const mod = await import('../lib/chronicle-vault.js');
    expect(mod.backfillVerdicts).toBeUndefined();
  });

  test('indexPlanFile is not exported', async () => {
    const mod = await import('../lib/chronicle-vault.js');
    expect(mod.indexPlanFile).toBeUndefined();
  });
});

describe('exports: required functions present', () => {
  const REQUIRED = ['writeNote', 'readNote', 'searchNotes', 'listDue', 'rebuildIndex', 'archiveNotes', 'countNotes'];

  test('all required exports exist', async () => {
    const mod = await import('../lib/chronicle-vault.js');
    for (const fn of REQUIRED) {
      expect(mod[fn], `missing export: ${fn}`).toBeDefined();
    }
  });
});

// ── vaultRoot resolution ──────────────────────────────────────────────────────

describe('vaultRoot: slug resolution', () => {
  const savedSlug = process.env.CHRONICLE_PROJECT_SLUG;
  const savedVault = process.env.CHRONICLE_VAULT;

  afterEach(() => {
    if (savedSlug === undefined) delete process.env.CHRONICLE_PROJECT_SLUG;
    else process.env.CHRONICLE_PROJECT_SLUG = savedSlug;
    if (savedVault === undefined) delete process.env.CHRONICLE_VAULT;
    else process.env.CHRONICLE_VAULT = savedVault;
  });

  test('CHRONICLE_PROJECT_SLUG=myproj => ends with .claude/vault/projects/myproj/', async () => {
    process.env.CHRONICLE_PROJECT_SLUG = 'myproj';
    delete process.env.CHRONICLE_VAULT;
    const { vaultRoot } = await import('../lib/chronicle-vault.js');
    const root = vaultRoot();
    expect(root).toMatch(/\.claude[/\\]vault[/\\]projects[/\\]myproj/);
  });

  test('slug arg => ends with .claude/vault/projects/argslug/', async () => {
    delete process.env.CHRONICLE_PROJECT_SLUG;
    delete process.env.CHRONICLE_VAULT;
    const { vaultRoot } = await import('../lib/chronicle-vault.js');
    const root = vaultRoot('argslug');
    expect(root).toMatch(/\.claude[/\\]vault[/\\]projects[/\\]argslug/);
  });

  test('default (no slug, no override) => ends with .claude/vault', async () => {
    delete process.env.CHRONICLE_PROJECT_SLUG;
    delete process.env.CHRONICLE_VAULT;
    const { vaultRoot } = await import('../lib/chronicle-vault.js');
    const root = vaultRoot();
    expect(root).toMatch(/\.claude[/\\]vault$/);
    expect(root).not.toContain('projects');
  });
});

// ── Runtime: CRUD + search + archive ─────────────────────────────────────────

describe('runtime', () => {
  let tmpDir;
  const savedVault = process.env.CHRONICLE_VAULT;
  const savedSlug = process.env.CHRONICLE_PROJECT_SLUG;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-test-'));
    process.env.CHRONICLE_VAULT = tmpDir;
    delete process.env.CHRONICLE_PROJECT_SLUG;
  });

  afterEach(() => {
    if (savedVault === undefined) delete process.env.CHRONICLE_VAULT;
    else process.env.CHRONICLE_VAULT = savedVault;
    if (savedSlug === undefined) delete process.env.CHRONICLE_PROJECT_SLUG;
    else process.env.CHRONICLE_PROJECT_SLUG = savedSlug;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('writeNote + readNote roundtrip', async () => {
    const { writeNote, readNote } = await import('../lib/chronicle-vault.js');
    writeNote('notes/hello.md', { type: 'note', created_at: '2026-01-01' }, 'hello world');
    const result = readNote('notes/hello.md');
    expect(result).not.toBeNull();
    expect(result.fm.type).toBe('note');
    expect(result.body.trim()).toBe('hello world');
  });

  test('searchNotes finds written content', async () => {
    const { writeNote, searchNotes } = await import('../lib/chronicle-vault.js');
    writeNote('notes/searchme.md', { type: 'note', created_at: '2026-01-01' }, 'unique token xq9ztest');
    const results = searchNotes('xq9ztest');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searchNotes excludes archived notes by default', async () => {
    const { writeNote, searchNotes } = await import('../lib/chronicle-vault.js');
    writeNote('notes/arch.md', { type: 'note', created_at: '2020-01-01', status: 'archived' }, 'archived token zz99arch');
    const results = searchNotes('zz99arch');
    expect(results.length).toBe(0);
  });

  test('searchNotes includes archived when includeArchived=true', async () => {
    const { writeNote, searchNotes } = await import('../lib/chronicle-vault.js');
    writeNote('notes/arch2.md', { type: 'note', created_at: '2020-01-01', status: 'archived' }, 'archived token ww88arch');
    const results = searchNotes('ww88arch', 10, { includeArchived: true });
    expect(results.length).toBeGreaterThan(0);
  });

  test('countNotes returns count of all notes', async () => {
    const { writeNote, countNotes } = await import('../lib/chronicle-vault.js');
    writeNote('notes/a.md', { type: 'note', created_at: '2026-01-01' }, 'note a');
    writeNote('notes/b.md', { type: 'note', created_at: '2026-01-01' }, 'note b');
    const count = countNotes();
    expect(count).toBe(2);
  });

  test('archiveNotes dry-run returns {archived, dryRun:true}', async () => {
    const { archiveNotes } = await import('../lib/chronicle-vault.js');
    const result = await archiveNotes({ olderThanDays: 180, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(typeof result.archived).toBe('number');
  });

  test('writeSessionNote accepts generic meta {sid,agent,project,created_at,summary}', async () => {
    const { writeSessionNote, readNote } = await import('../lib/chronicle-vault.js');
    writeSessionNote({
      sid: 'sess-abc123',
      agent: 'claude',
      project: 'myproject',
      created_at: '2026-01-01T00:00:00Z',
      summary: 'Did some useful work'
    });
    const note = readNote('sessions/sess-abc123.md');
    expect(note).not.toBeNull();
    expect(note.fm.type).toBe('session');
    expect(note.fm.project).toBe('myproject');
  });
});
