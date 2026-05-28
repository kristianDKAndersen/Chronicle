import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const SCRIPT = path.resolve(import.meta.dir, '../scripts/migrate-from-advisor.sh');

let srcDir, tgtDir;

function setupFixtures(dir) {
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lessons'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cache'), { recursive: true });

  // Valid note 1 — session with advisor fields
  fs.writeFileSync(
    path.join(dir, 'sessions', 'note1.md'),
    '---\ntype: session\nsid: 1779000001-abc00001\nagent: claude\nrepo: my-repo\ncreated_at: 2024-01-01T00:00:00.000Z\n---\n\nSession body text.'
  );

  // Valid note 2 — lesson with advisor fields
  fs.writeFileSync(
    path.join(dir, 'lessons', 'note2.md'),
    '---\ntype: lesson\nsid: 1779000002-abc00002\nagent: claude\nrepo: other-repo\nestablished: 2024-01-02\n---\n\nLesson body text.'
  );

  // Multi-line frontmatter — must be skipped with warning
  fs.writeFileSync(
    path.join(dir, 'sessions', 'multiline.md'),
    '---\ntype: session\ndescription: |\n  line one\n  line two\n---\n\nMulti-line body.'
  );

  // Cache file — must be skipped (not .md, but verify walk skips .cache dir)
  fs.writeFileSync(path.join(dir, '.cache', 'vault.db'), 'binary');
}

beforeEach(() => {
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-migrate-src-'));
  tgtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-migrate-tgt-'));
  setupFixtures(srcDir);
});

afterEach(() => {
  try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(tgtDir, { recursive: true, force: true }); } catch (_) {}
});

function countMdFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.cache') count += countMdFiles(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) count++;
  }
  return count;
}

describe('dry-run: lists count, writes nothing', () => {
  test('exits 0, reports note count, writes 0 md files to target', () => {
    const result = spawnSync(
      'bash',
      [SCRIPT, '--source', srcDir, '--dry-run'],
      { env: { ...process.env, CHRONICLE_VAULT: tgtDir, CHRONICLE_PROJECT_SLUG: '' }, encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    const output = (result.stdout || '') + (result.stderr || '');
    // Should mention count of valid notes (2)
    expect(output).toMatch(/2/);
    // Nothing written to target
    expect(countMdFiles(tgtDir)).toBe(0);
  });
});

describe('real run: count preserved, non-destructive', () => {
  test('imports all valid notes and reports correct count', () => {
    const result = spawnSync(
      'bash',
      [SCRIPT, '--source', srcDir, '--target', 'test-migrate-slug'],
      { env: { ...process.env, CHRONICLE_VAULT: tgtDir, CHRONICLE_PROJECT_SLUG: '' }, encoding: 'utf8' }
    );
    expect(result.status).toBe(0);
    const output = (result.stdout || '') + (result.stderr || '');
    expect(output).toMatch(/Imported 2 notes/);
    expect(output).toMatch(/Index rebuilt/);
    expect(output).toMatch(/Source vault untouched/);
    // 2 .md notes written to target vault
    expect(countMdFiles(tgtDir)).toBe(2);
  });

  test('source fixture files are byte-unchanged after import', () => {
    const before1 = fs.readFileSync(path.join(srcDir, 'sessions', 'note1.md'));
    const before2 = fs.readFileSync(path.join(srcDir, 'lessons', 'note2.md'));
    const beforeM = fs.readFileSync(path.join(srcDir, 'sessions', 'multiline.md'));

    spawnSync(
      'bash',
      [SCRIPT, '--source', srcDir, '--target', 'test-migrate-slug'],
      { env: { ...process.env, CHRONICLE_VAULT: tgtDir, CHRONICLE_PROJECT_SLUG: '' }, encoding: 'utf8' }
    );

    expect(fs.readFileSync(path.join(srcDir, 'sessions', 'note1.md'))).toEqual(before1);
    expect(fs.readFileSync(path.join(srcDir, 'lessons', 'note2.md'))).toEqual(before2);
    expect(fs.readFileSync(path.join(srcDir, 'sessions', 'multiline.md'))).toEqual(beforeM);
  });

  test('multi-line-frontmatter note is skipped with a warning', () => {
    const result = spawnSync(
      'bash',
      [SCRIPT, '--source', srcDir, '--target', 'test-migrate-slug'],
      { env: { ...process.env, CHRONICLE_VAULT: tgtDir, CHRONICLE_PROJECT_SLUG: '' }, encoding: 'utf8' }
    );
    const output = (result.stdout || '') + (result.stderr || '');
    expect(output).toMatch(/multiline\.md/);
    expect(output.toLowerCase()).toMatch(/multi.?line|skip/);
  });
});
