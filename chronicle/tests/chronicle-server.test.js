// chronicle/tests/chronicle-server.test.js
// Tests for the MCP server — 6 tools + vault_search round-trip.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Static check: server file exists
describe('static: server file exists', () => {
  test('chronicle/servers/chronicle-server.js is present', () => {
    const serverPath = path.resolve(__dirname, '../servers/chronicle-server.js');
    expect(fs.existsSync(serverPath), `missing ${serverPath}`).toBe(true);
  });
});

// Dynamic: connect via InMemoryTransport and interrogate the server
describe('chronicle-server: tool declarations and search round-trip', () => {
  let client;
  let tmpDir;
  let savedEnv;

  beforeEach(async () => {
    // Snapshot env vars that the server startup mutates
    savedEnv = {
      CHRONICLE_DATA_DIR: process.env.CHRONICLE_DATA_DIR,
      CHRONICLE_PROJECT_SLUG: process.env.CHRONICLE_PROJECT_SLUG,
      CHRONICLE_VAULT: process.env.CHRONICLE_VAULT,
    };

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-srv-test-'));
    process.env.CHRONICLE_DATA_DIR = tmpDir;
    process.env.CHRONICLE_PROJECT_SLUG = 'test-proj';

    // Dynamic import so beforeEach sees the latest env vars.
    // Module is cached after first import; createServer() is a factory.
    const { createServer } = await import('../servers/chronicle-server.js');
    const server = createServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client?.close();
    // Restore env
    const restoreOrDelete = (key, prev) => {
      if (prev !== undefined) process.env[key] = prev;
      else delete process.env[key];
    };
    restoreOrDelete('CHRONICLE_DATA_DIR', savedEnv.CHRONICLE_DATA_DIR);
    restoreOrDelete('CHRONICLE_PROJECT_SLUG', savedEnv.CHRONICLE_PROJECT_SLUG);
    restoreOrDelete('CHRONICLE_VAULT', savedEnv.CHRONICLE_VAULT);
    // Clean up temp dir (vault singleton's db is closed on path change next run)
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('declares exactly 6 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual([
      'vault_backlinks',
      'vault_due',
      'vault_neighbors',
      'vault_recent',
      'vault_search',
      'vault_write',
    ]);
  });

  test('vault_search returns seeded note', async () => {
    // Seed a note via the vault lib — after createServer() set CHRONICLE_VAULT
    const { writeNote } = await import('../lib/chronicle-vault.js');
    writeNote('notes/canary.md', {
      type: 'synthesis',
      created_at: new Date().toISOString(),
    }, 'The quick brown fox jumped over the lazy dog');

    const result = await client.callTool({
      name: 'vault_search',
      arguments: { query: 'quick brown fox', limit: 5 },
    });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].path).toContain('canary');
  });
});
