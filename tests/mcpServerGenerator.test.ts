/**
 * MCP server generator — the user's app, usable from Claude Desktop / Cursor.
 *
 * The dangerous mistakes here are not syntax errors, they are POWER mistakes. An MCP server is driven
 * by an AI with no human approving each call, so the things that must never regress are: it cannot
 * delete, it cannot bypass row-level security, it cannot be talked into touching a table it was not
 * generated for, and it cannot be asked to dump a whole table into the assistant's context. Each has a
 * test, and each is the reason the generated default is read-only.
 */

import { describe, it, expect } from 'vitest';
import {
  generateMcpServer,
  normalizeMcpTables,
  MCP_TABLE_RE,
  MCP_MAX_ROWS,
} from '../src/server/lib/McpServerGenerator';

const gen = (tables: string[], allowWrites = false) =>
  generateMcpServer({ tables, allowWrites, appName: 'Shop' });

const serverOf = (tables: string[], allowWrites = false) => gen(tables, allowWrites).files['mcp-server/index.js'];

describe('normalizeMcpTables', () => {
  it('accepts real table names and de-duplicates them', () => {
    const r = normalizeMcpTables(['orders', 'Orders', 'menu_items']);
    expect(r.ok && r.tables).toEqual(['orders', 'menu_items']);
  });

  it('accepts a comma-separated string, which is how an AI often passes a list', () => {
    const r = normalizeMcpTables('orders, customers');
    expect(r.ok && r.tables).toEqual(['orders', 'customers']);
  });

  it('🔒 REJECTS anything that is not a plain identifier, rather than escaping it', () => {
    // These names are interpolated into generated source. Rejecting is a clear message; escaping is a
    // bug waiting for a future edit to undo.
    for (const bad of ["orders'; drop table users; --", 'has space', 'x'.repeat(80), 'tab;le', '1', '']) {
      expect(normalizeMcpTables([bad]).ok, bad).toBe(false);
    }
    expect(MCP_TABLE_RE.test('menu_items')).toBe(true);
  });

  it('names the invalid entries so the caller can fix them', () => {
    const r = normalizeMcpTables(['bad name']);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('bad name');
  });

  it('refuses an empty list and an unusable number of tables', () => {
    expect(normalizeMcpTables([]).ok).toBe(false);
    expect(normalizeMcpTables(Array.from({ length: 30 }, (_, i) => `t${i}`)).ok).toBe(false);
  });
});

describe('🔒 what the generated server can never do', () => {
  it('NEVER generates a delete tool — not even with writes enabled', () => {
    // The whole point of MCP is that a human is not approving each call. A misread instruction must not
    // be able to destroy the user's real production data.
    for (const writes of [false, true]) {
      const src = serverOf(['orders'], writes);
      expect(src, `writes=${writes}`).not.toContain('delete_orders');
      expect(src, `writes=${writes}`).not.toMatch(/\.delete\s*\(/);
    }
  });

  it('NEVER uses a service-role key — RLS must still apply', () => {
    const src = serverOf(['orders'], true);
    expect(src).toContain('SUPABASE_ANON_KEY');
    expect(src.toLowerCase()).not.toContain('service_role');
    expect(src.toLowerCase()).not.toContain('service-role');
  });

  it('is READ-ONLY unless writes were explicitly requested', () => {
    const readOnly = serverOf(['orders']);
    expect(readOnly).not.toContain('.insert(');
    expect(readOnly).not.toContain('.update(');
    expect(readOnly).toContain('READ-ONLY');

    const writable = serverOf(['orders'], true);
    expect(writable).toContain('.insert(');
    expect(writable).toContain('.update(');
  });

  it('🔒 resolves every tool name against the allow-list, so an unknown table is refused', () => {
    // A tool name arrives from the client and is attacker-controlled like any other input. Slicing a
    // prefix off it and trusting the rest as a table name would be a straight IDOR onto any table.
    const src = serverOf(['orders']);
    expect(src).toContain('function requireTable');
    expect(src).toContain("if (!TABLES.includes(name)) throw new Error('Unknown table: ' + name)");
    for (const call of ['list_', 'get_', 'search_']) {
      expect(src, call).toContain(`requireTable(name.slice('${call}'.length))`);
    }
  });

  it('🔒 bounds every read — an unbounded one would blow past the assistant context and cost real money', () => {
    const src = serverOf(['orders']);
    expect(src).toContain(`const MAX_ROWS = ${MCP_MAX_ROWS}`);
    expect(src).toContain('Math.min(Number(args.limit) || DEFAULT_ROWS, MAX_ROWS)');
    // The list query is limited at the query itself, not merely sliced after fetching everything.
    expect(src).toMatch(/\.select\('\*'\)\.limit\(limit\)/);
  });
});

describe('the generated server is real, runnable code', () => {
  it('speaks MCP over stdio, the transport desktop clients actually use', () => {
    const src = serverOf(['orders']);
    expect(src).toContain("@modelcontextprotocol/sdk/server/index.js");
    expect(src).toContain('StdioServerTransport');
    expect(src).toContain('ListToolsRequestSchema');
    expect(src).toContain('CallToolRequestSchema');
    expect(src).toContain('server.connect(transport)');
  });

  it('🔒 never logs to stdout — that channel IS the protocol', () => {
    // A stray console.log corrupts the MCP stream and the client silently fails to connect.
    const src = serverOf(['orders'], true);
    expect(src).not.toContain('console.log');
    expect(src).toContain('console.error');
  });

  it('fails at startup when the connection details are missing, not on the first tool call', () => {
    const src = serverOf(['orders']);
    expect(src).toContain('Set SUPABASE_URL and SUPABASE_ANON_KEY');
    expect(src).toContain('process.exit(1)');
  });

  it('generates list/get/search for every table asked for', () => {
    const src = serverOf(['orders', 'customers']);
    expect(src).toContain("const TABLES = ['orders', 'customers']");
    for (const t of ['list_', 'get_', 'search_']) expect(src).toContain(`'${t}' + table`.replace(" + table", " + table"));
  });

  it('ships the files a user needs to actually connect it', () => {
    const cfg = gen(['orders']);
    expect(Object.keys(cfg.files).sort()).toEqual([
      'mcp-server/README.md',
      'mcp-server/claude_desktop_config.json',
      'mcp-server/index.js',
    ]);
    const client = JSON.parse(cfg.files['mcp-server/claude_desktop_config.json']);
    expect(client.mcpServers.shop.command).toBe('node');
    expect(client.mcpServers.shop.args).toEqual(['mcp-server/index.js']);
  });

  it('tells the user honestly what it can and cannot do', () => {
    expect(gen(['orders']).files['mcp-server/README.md']).toContain('READ-ONLY');
    const writable = gen(['orders'], true).files['mcp-server/README.md'];
    expect(writable).toContain('never DELETE');
    expect(writable).toContain('Never put a\nservice-role key here');
  });

  it('declares the real dependencies and the public env keys only', () => {
    const cfg = gen(['orders']);
    expect(cfg.dependencies.map((d) => d.name)).toEqual(['@modelcontextprotocol/sdk', '@supabase/supabase-js']);
    expect(cfg.envKeys).toEqual(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);
  });

  it('the instructions state the safety posture, not just the file list', () => {
    expect(gen(['orders']).instructions).toContain('read-only');
    expect(gen(['orders'], true).instructions).toContain('no delete');
    expect(gen(['orders']).instructions).toContain('anon key');
  });
});

describe('the generated JavaScript actually parses', () => {
  it('🔒 is syntactically valid for both settings', async () => {
    // This file is produced FROM a template literal, so an escaping slip would ship a broken server
    // into a user's app that no test of ours would otherwise notice.
    const { parse } = await import('acorn');
    for (const writes of [false, true]) {
      const src = serverOf(['orders', 'menu_items'], writes);
      // The `#!` line is deliberate — this is a runnable script — and Node strips it, but acorn does
      // not accept it, so it is removed here and asserted separately below.
      expect(src.startsWith('#!/usr/bin/env node\n'), `writes=${writes}`).toBe(true);
      expect(
        () => parse(src.slice(src.indexOf('\n') + 1), { ecmaVersion: 2022, sourceType: 'module', allowAwaitOutsideFunction: true }),
        `writes=${writes}`,
      ).not.toThrow();
    }
  });

  it('the client config is valid JSON', () => {
    expect(() => JSON.parse(gen(['orders']).files['mcp-server/claude_desktop_config.json'])).not.toThrow();
  });
});
