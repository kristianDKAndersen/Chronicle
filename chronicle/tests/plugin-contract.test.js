// chronicle/tests/plugin-contract.test.js
// Contract assertions: plugin manifest, MCP config, and server slug derivation.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_JSON = path.resolve(__dirname, '../.claude-plugin/plugin.json');
const MCP_JSON = path.resolve(__dirname, '../.mcp.json');
const HOOKS_JSON = path.resolve(__dirname, '../hooks/hooks.json');

// ── FIX 1: plugin.json manifest schema ─────────────────────────────────────
describe('plugin.json: userConfig is an object map', () => {
  let manifest;
  test('plugin.json parses as valid JSON', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    manifest = JSON.parse(raw);
    expect(manifest).toBeTruthy();
  });

  test('userConfig is a plain object, not an array', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    manifest = JSON.parse(raw);
    expect(Array.isArray(manifest.userConfig)).toBe(false);
    expect(typeof manifest.userConfig).toBe('object');
    expect(manifest.userConfig).not.toBeNull();
  });

  test('userConfig has exactly 6 keys', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    manifest = JSON.parse(raw);
    const keys = Object.keys(manifest.userConfig);
    expect(keys).toHaveLength(6);
    expect(keys).toContain('capture_profile');
    expect(keys).toContain('significance_mode');
    expect(keys).toContain('auto_write_on_stop');
    expect(keys).toContain('lesson_on_failure');
    expect(keys).toContain('surface_due_on_start');
    expect(keys).toContain('max_notes_before_prune');
  });

  test('no userConfig entry has an "options" key', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    manifest = JSON.parse(raw);
    for (const [key, entry] of Object.entries(manifest.userConfig)) {
      expect(Object.keys(entry), `${key} must not have "options"`).not.toContain('options');
    }
  });

  test('capture_profile and significance_mode have type "string"', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    manifest = JSON.parse(raw);
    expect(manifest.userConfig.capture_profile.type).toBe('string');
    expect(manifest.userConfig.significance_mode.type).toBe('string');
  });
});

describe('plugin.json: hooks and mcpServers are strings (or absent)', () => {
  test('hooks field is a string or absent', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    const manifest = JSON.parse(raw);
    if ('hooks' in manifest) {
      expect(typeof manifest.hooks).toBe('string');
    }
  });

  test('mcpServers field is a string or absent', () => {
    const raw = fs.readFileSync(PLUGIN_JSON, 'utf8');
    const manifest = JSON.parse(raw);
    if ('mcpServers' in manifest) {
      expect(typeof manifest.mcpServers).toBe('string');
    }
  });
});

// ── FIX 4: hook commands must use an absolute ${CLAUDE_PLUGIN_ROOT} path ──────
// Hooks run via /bin/sh, which does NOT have the plugin bin/ on PATH (only the
// Bash tool does). A bare "chronicle-write ..." command fails at hook time with
// "command not found". Every hook command must resolve the binary by absolute
// path via ${CLAUDE_PLUGIN_ROOT}.
describe('hooks.json: commands resolve the binary by absolute plugin path', () => {
  test('hooks.json parses as valid JSON', () => {
    const cfg = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
    expect(cfg).toBeTruthy();
  });

  test('every hook command references ${CLAUDE_PLUGIN_ROOT}/bin/chronicle-write, never a bare command', () => {
    const cfg = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
    const commands = [];
    for (const matchers of Object.values(cfg.hooks)) {
      for (const m of matchers) {
        for (const h of m.hooks ?? []) {
          if (h.type === 'command') commands.push(h.command);
        }
      }
    }
    expect(commands.length).toBeGreaterThanOrEqual(3);
    for (const cmd of commands) {
      expect(cmd, `hook command must use absolute plugin path: ${cmd}`)
        .toContain('${CLAUDE_PLUGIN_ROOT}/bin/chronicle-write');
      expect(cmd, `hook command must not invoke a bare chronicle-write: ${cmd}`)
        .not.toMatch(/^chronicle-write\b/);
    }
  });
});

// ── FIX 2: .mcp.json env var ─────────────────────────────────────────────────
describe('.mcp.json: env uses CHRONICLE_PROJECT_DIR, not CLAUDE_PROJECT_SLUG', () => {
  test('.mcp.json parses as valid JSON', () => {
    const raw = fs.readFileSync(MCP_JSON, 'utf8');
    const cfg = JSON.parse(raw);
    expect(cfg).toBeTruthy();
  });

  test('chronicle server env has CHRONICLE_PROJECT_DIR', () => {
    const raw = fs.readFileSync(MCP_JSON, 'utf8');
    const cfg = JSON.parse(raw);
    const env = cfg?.mcpServers?.chronicle?.env ?? {};
    expect(Object.keys(env)).toContain('CHRONICLE_PROJECT_DIR');
  });

  test('chronicle server env does NOT reference CLAUDE_PROJECT_SLUG', () => {
    const raw = fs.readFileSync(MCP_JSON, 'utf8');
    const text = raw;
    expect(text).not.toContain('CLAUDE_PROJECT_SLUG');
  });
});

// ── FIX 3: server derives slug from CHRONICLE_PROJECT_DIR ────────────────────
describe('chronicle-server: slug derivation from CHRONICLE_PROJECT_DIR', () => {
  let tmpDir;
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      CHRONICLE_DATA_DIR: process.env.CHRONICLE_DATA_DIR,
      CHRONICLE_PROJECT_DIR: process.env.CHRONICLE_PROJECT_DIR,
      CHRONICLE_PROJECT_SLUG: process.env.CHRONICLE_PROJECT_SLUG,
      CHRONICLE_VAULT: process.env.CHRONICLE_VAULT,
    };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chr-contract-'));
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('vault path contains basename of CHRONICLE_PROJECT_DIR when slug is not set', async () => {
    process.env.CHRONICLE_DATA_DIR = tmpDir;
    process.env.CHRONICLE_PROJECT_DIR = '/tmp/foo-proj';
    delete process.env.CHRONICLE_PROJECT_SLUG;
    delete process.env.CHRONICLE_VAULT;

    // Re-import the module to pick up env (module is cached; call factory directly)
    const mod = await import('../servers/chronicle-server.js');
    // createServer calls resolveVaultRoot() internally
    // We need to call it and check the resulting CHRONICLE_VAULT
    mod.createServer();
    const vaultPath = process.env.CHRONICLE_VAULT ?? '';
    expect(vaultPath).toContain('foo-proj');
  });
});
