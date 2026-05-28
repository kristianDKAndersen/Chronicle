import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { archiveNotes, listArchived, countNotes, writeNote } from '../lib/chronicle-vault.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-archive-'));
  process.env.CHRONICLE_VAULT = tmpDir;
});

afterEach(() => {
  delete process.env.CHRONICLE_VAULT;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
});

describe('archiveNotes: dryRun=true', () => {
  test('returns result with dryRun:true and writes nothing', async () => {
    const result = await archiveNotes({ olderThanDays: 180, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'archive'))).toBe(false);
  });
});

describe('archiveNotes: non-dryRun moves old session notes', () => {
  test('moves file to archive/ and listArchived returns it', async () => {
    const sessionPath = 'sessions/old-session.md';
    writeNote(sessionPath, {
      type: 'session',
      sid: 'old-session',
      created_at: '2020-01-01T00:00:00.000Z'
    }, 'Old session content');

    const result = await archiveNotes({ olderThanDays: 180, dryRun: false });
    expect(result.archived).toBeGreaterThan(0);

    expect(fs.existsSync(path.join(tmpDir, 'archive', 'old-session.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, sessionPath))).toBe(false);

    const archived = listArchived();
    expect(Array.isArray(archived)).toBe(true);
    expect(archived.length).toBeGreaterThan(0);
    expect(archived.some(n => n.path === sessionPath)).toBe(true);
  });
});

describe('countNotes', () => {
  test('returns correct count after writing a note', () => {
    const before = countNotes();
    writeNote('sessions/count-test.md', {
      type: 'session',
      sid: 'count-test',
      created_at: new Date().toISOString()
    }, 'Count test body');
    const after = countNotes();
    expect(after).toBe(before + 1);
  });
});
