// chronicle/servers/chronicle-server.js
// Runtime: Bun — @modelcontextprotocol/sdk@1.29.0 confirmed compatible under Bun (Spike S3: RESOLVED, Bun).
// Env: CHRONICLE_DATA_DIR (CLAUDE_PLUGIN_DATA), CHRONICLE_PROJECT_SLUG (CLAUDE_PROJECT_SLUG).
// Startup resolves vault root = path.join(DATA_DIR, 'projects', SLUG), writes to CHRONICLE_VAULT,
// then clears CHRONICLE_PROJECT_SLUG so chronicle-vault.js uses CHRONICLE_VAULT for all ops.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  searchNotes,
  listDue,
  backlinks,
  neighbors,
  writeNote,
  vaultRoot,
} from '../lib/chronicle-vault.js';

// S2 confirmation: env vars are CHRONICLE_DATA_DIR and CHRONICLE_PROJECT_SLUG (per .mcp.json).
function resolveVaultRoot() {
  const dataDir = process.env.CHRONICLE_DATA_DIR;
  const slug = process.env.CHRONICLE_PROJECT_SLUG;
  if (dataDir && slug) {
    process.env.CHRONICLE_VAULT = path.join(dataDir, 'projects', slug);
    delete process.env.CHRONICLE_PROJECT_SLUG;
  }
}

export function createServer() {
  resolveVaultRoot();

  const server = new McpServer({ name: 'chronicle', version: '1.0.0' });

  server.tool(
    'vault_search',
    'Full-text search vault notes via BM25 FTS5',
    { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    async ({ query, limit = 10 }) => ({
      content: [{ type: 'text', text: JSON.stringify(searchNotes(query, limit)) }],
    })
  );

  server.tool(
    'vault_due',
    'List notes with due dates within a rolling window from today',
    { withinDays: z.number().int().min(0).optional() },
    async ({ withinDays = 14 }) => ({
      content: [{
        type: 'text',
        text: JSON.stringify(listDue(new Date().toISOString().slice(0, 10), withinDays)),
      }],
    })
  );

  server.tool(
    'vault_recent',
    'List most recently created vault notes, optionally filtered by type',
    { limit: z.number().int().min(1).max(100).optional(), type: z.string().optional() },
    async ({ limit = 20, type }) => {
      try {
        const dbFile = path.join(vaultRoot(), '.cache', 'vault.db');
        if (!fs.existsSync(dbFile)) return { content: [{ type: 'text', text: '[]' }] };
        const db = new Database(dbFile, { readonly: true, create: false });
        const rows = type
          ? db.prepare(
              `SELECT path, type, created_at, body FROM notes
               WHERE archived != 1 AND type = ? ORDER BY created_at DESC LIMIT ?`
            ).all(type, limit)
          : db.prepare(
              `SELECT path, type, created_at, body FROM notes
               WHERE archived != 1 ORDER BY created_at DESC LIMIT ?`
            ).all(limit);
        db.close();
        return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
      } catch (_) {
        return { content: [{ type: 'text', text: '[]' }] };
      }
    }
  );

  server.tool(
    'vault_backlinks',
    'Find notes that link to a given note',
    { noteName: z.string() },
    async ({ noteName }) => ({
      content: [{ type: 'text', text: JSON.stringify(backlinks(noteName)) }],
    })
  );

  server.tool(
    'vault_neighbors',
    'Find neighboring notes connected by wikilinks',
    { noteName: z.string(), depth: z.number().int().min(1).max(3).optional() },
    async ({ noteName, depth = 1 }) => ({
      content: [{ type: 'text', text: JSON.stringify(neighbors(noteName, depth)) }],
    })
  );

  server.tool(
    'vault_write',
    'Write a note to the vault; performs search-before-write and returns any near-match',
    {
      relPath: z.string(),
      frontmatter: z.record(z.string(), z.unknown()),
      body: z.string(),
    },
    async ({ relPath, frontmatter, body }) => {
      const preview = body.trim().slice(0, 100);
      const nearMatch = preview ? searchNotes(preview, 1) : [];
      writeNote(relPath, frontmatter, body);
      return {
        content: [{ type: 'text', text: JSON.stringify({ written: relPath, nearMatch }) }],
      };
    }
  );

  return server;
}

// Stdio entry point
const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
