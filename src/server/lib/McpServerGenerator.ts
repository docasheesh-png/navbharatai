/**
 * MCP SERVER GENERATOR — make the user's app usable from Claude Desktop, Cursor, or any MCP client.
 *
 * ROADMAP §2 ("MCP support"), verified absent: nothing imports `@modelcontextprotocol`.
 *
 * WHICH "MCP SUPPORT" THIS IS, AND WHY. There were three readings, and they are not equally useful to
 * the people this product is for:
 *   (a) the BUILDER acts as an MCP client — a developer-platform feature; the person building a shop
 *       app does not have MCP servers to connect;
 *   (b) NavBharatAI exposes ITSELF over MCP — a much larger surface (auth, transport, session
 *       security) whose users would be other developers, not our users;
 *   (c) the USER'S APP gets its own MCP server — their data becomes usable from an AI assistant.
 * (c) is the one that gives OUR user a capability they can actually use, so that is what this builds.
 *
 * 🔒 READ-ONLY BY DEFAULT, AND THAT IS A SAFETY DECISION, NOT A SCOPE ONE. An MCP server is driven by
 * an AI, and the whole point is that a human is not approving each call. A generated server that could
 * DELETE rows would mean a misread instruction can destroy the user's real production data. Writes are
 * therefore opt-in, and even then are limited to insert/update — never delete.
 *
 * 🔒 ANON KEY ONLY. The server authenticates exactly like the app's own browser code, so the user's own
 * row-level security rules still apply. A service-role key would bypass RLS entirely and hand an AI
 * unrestricted access to every row of every table — so it is never fetched and never written.
 *
 * ⚠️ THE SERVER RUNS ON THE USER'S OWN MACHINE against the USER's own database, which is the standing
 * rule (user apps run on the user's account, never NavBharatAI's).
 */

/** A Postgres identifier we are willing to interpolate into generated code. */
export const MCP_TABLE_RE = /^[a-z_][a-z0-9_]{0,62}$/i;

/** Rows one tool call may return. An AI context cannot hold a whole table, and asking for one is how a
 *  user discovers their token budget the hard way. */
export const MCP_MAX_ROWS = 200;
export const MCP_DEFAULT_ROWS = 25;

export interface McpServerSpec {
  /** Tables to expose. Each becomes list/get/search tools. */
  tables: string[];
  /**
   * `true` also generates insert/update tools. Off by default — see the safety note in the header.
   * Delete is NEVER generated, at any setting.
   */
  allowWrites?: boolean;
  /** Shown to the MCP client as the server's name. */
  appName?: string;
}

export interface McpServerConfig {
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

export type McpTablesResult =
  | { ok: true; tables: string[] }
  | { ok: false; message: string };

/**
 * Validate and normalise the table list.
 *
 * Names are interpolated into the generated source, so anything that is not a plain identifier is
 * REJECTED rather than escaped — a rejected name is a clear message, while a cleverly escaped one is a
 * bug waiting for a future edit to undo.
 */
export function normalizeMcpTables(input: unknown): McpTablesResult {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? String(input).split(',') : [];
  const seen = new Set<string>();
  const tables: string[] = [];
  const rejected: string[] = [];
  for (const item of raw) {
    const name = String(item ?? '').trim().toLowerCase();
    if (!name) continue;
    if (!MCP_TABLE_RE.test(name)) { rejected.push(name); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    tables.push(name);
  }
  if (tables.length === 0) {
    return {
      ok: false,
      message: rejected.length > 0
        ? `These are not valid table names: ${rejected.join(', ')}. Use plain names like "orders" or "menu_items".`
        : 'Name at least one table to expose, e.g. ["orders", "customers"].',
    };
  }
  if (tables.length > 25) return { ok: false, message: 'Expose at most 25 tables — an AI client shows a list of every tool, and hundreds make it unusable.' };
  return { ok: true, tables };
}

/** A JS single-quoted string literal. Names are validated too; this is the layer that must not be skipped. */
const q = (v: string): string => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * The MCP server itself.
 *
 * Deliberately written with string concatenation rather than template literals: this source is itself
 * produced from a template literal, and nesting them is how an escaping bug silently ships broken code
 * into a user's app.
 */
function serverSource(spec: Required<Pick<McpServerSpec, 'tables' | 'allowWrites' | 'appName'>>): string {
  const { tables, allowWrites, appName } = spec;
  const tableList = tables.map(q).join(', ');

  const writeTools = allowWrites
    ? `
  // Write tools exist only because this server was generated with writes enabled. DELETE is never
  // generated at any setting: an AI acting on a misread instruction must not be able to destroy data.
  for (const table of TABLES) {
    tools.push({
      name: 'create_' + table,
      description: 'Add one new row to ' + table + '.',
      inputSchema: { type: 'object', properties: { values: { type: 'object', description: 'Column values for the new row.' } }, required: ['values'] },
    });
    tools.push({
      name: 'update_' + table,
      description: 'Change one existing row of ' + table + ', found by its id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, values: { type: 'object' } }, required: ['id', 'values'] },
    });
  }
`
    : '';

  const writeHandlers = allowWrites
    ? `
  if (name.startsWith('create_')) {
    const table = requireTable(name.slice('create_'.length));
    const { data, error } = await supabase.from(table).insert(args.values).select();
    if (error) return fail(error.message);
    return ok(data);
  }
  if (name.startsWith('update_')) {
    const table = requireTable(name.slice('update_'.length));
    const { data, error } = await supabase.from(table).update(args.values).eq('id', args.id).select();
    if (error) return fail(error.message);
    if (!data || data.length === 0) return fail('No row in ' + table + ' has id ' + args.id + '.');
    return ok(data);
  }
`
    : '';

  return `#!/usr/bin/env node
/**
 * MCP server for ${appName}.
 *
 * Lets an AI assistant (Claude Desktop, Cursor, …) read your app's real data. It talks to your own
 * database with the PUBLIC anon key, so your row-level security rules apply exactly as they do in your
 * app — this server can never see more than a signed-out visitor of your app could.
 *
 * ${allowWrites
    ? 'Writes are ENABLED: the assistant can add and change rows. It can never DELETE any.'
    : 'This server is READ-ONLY. It cannot change or delete anything.'}
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Fail loudly at startup rather than on the first tool call, where the assistant would report a
// confusing error the user cannot act on.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY before starting this server.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** The tables this server was generated to expose. Anything else is refused. */
const TABLES = [${tableList}];
const MAX_ROWS = ${MCP_MAX_ROWS};
const DEFAULT_ROWS = ${MCP_DEFAULT_ROWS};

/** A tool name is attacker-controlled input like any other — resolve it against the allow-list. */
function requireTable(name) {
  if (!TABLES.includes(name)) throw new Error('Unknown table: ' + name);
  return name;
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: 'Error: ' + message }], isError: true });

const server = new Server(
  { name: ${q(appName)}, version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];
  for (const table of TABLES) {
    tools.push({
      name: 'list_' + table,
      description: 'List rows from ' + table + '. Returns at most ' + MAX_ROWS + ' rows.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many rows (default ' + DEFAULT_ROWS + ', max ' + MAX_ROWS + ').' },
          order_by: { type: 'string', description: 'Column to sort by.' },
          descending: { type: 'boolean' },
        },
      },
    });
    tools.push({
      name: 'get_' + table,
      description: 'Get one row of ' + table + ' by its id.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    });
    tools.push({
      name: 'search_' + table,
      description: 'Find rows of ' + table + ' where a column contains some text.',
      inputSchema: {
        type: 'object',
        properties: {
          column: { type: 'string', description: 'The column to search in.' },
          query: { type: 'string', description: 'The text to look for.' },
          limit: { type: 'number' },
        },
        required: ['column', 'query'],
      },
    });
  }
${writeTools}  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  try {
    if (name.startsWith('list_')) {
      const table = requireTable(name.slice('list_'.length));
      // Always bounded: an unbounded read would blow past the assistant's context and cost the user
      // real money for rows it cannot use.
      const limit = Math.min(Number(args.limit) || DEFAULT_ROWS, MAX_ROWS);
      let query = supabase.from(table).select('*').limit(limit);
      if (args.order_by) query = query.order(String(args.order_by), { ascending: !args.descending });
      const { data, error } = await query;
      if (error) return fail(error.message);
      return ok(data);
    }

    if (name.startsWith('get_')) {
      const table = requireTable(name.slice('get_'.length));
      const { data, error } = await supabase.from(table).select('*').eq('id', args.id).maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail('No row in ' + table + ' has id ' + args.id + '.');
      return ok(data);
    }

    if (name.startsWith('search_')) {
      const table = requireTable(name.slice('search_'.length));
      const limit = Math.min(Number(args.limit) || DEFAULT_ROWS, MAX_ROWS);
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .ilike(String(args.column), '%' + String(args.query) + '%')
        .limit(limit);
      if (error) return fail(error.message);
      return ok(data);
    }
${writeHandlers}
    return fail('Unknown tool: ' + name);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is the MCP protocol channel — anything logged there corrupts it, so status goes to stderr.
console.error(${q(appName)} + ' MCP server ready.');
`;
}

/** The exact config block a user pastes into Claude Desktop / Cursor. */
function clientConfig(appName: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-app']: {
          command: 'node',
          args: ['mcp-server/index.js'],
          env: { SUPABASE_URL: 'your-project-url', SUPABASE_ANON_KEY: 'your-anon-key' },
        },
      },
    },
    null,
    2,
  ) + '\n';
}

/**
 * Generate a real, runnable MCP server for the app. Deterministic and pure — the caller writes the
 * files. Invalid table names are the caller's to reject first via `normalizeMcpTables`.
 */
export function generateMcpServer(spec: McpServerSpec): McpServerConfig {
  const tables = spec.tables;
  const allowWrites = spec.allowWrites === true;
  const appName = (spec.appName || 'My App').slice(0, 60);

  return {
    files: {
      'mcp-server/index.js': serverSource({ tables, allowWrites, appName }),
      'mcp-server/claude_desktop_config.json': clientConfig(appName),
      'mcp-server/README.md':
        `# ${appName} — AI assistant connection (MCP)\n\n` +
        `This lets Claude Desktop, Cursor or any MCP client read your app's data.\n\n` +
        `## Setup\n\n` +
        `1. \`npm install @modelcontextprotocol/sdk @supabase/supabase-js\`\n` +
        `2. Set \`SUPABASE_URL\` and \`SUPABASE_ANON_KEY\` (the same public values your app already uses).\n` +
        `3. Copy the contents of \`claude_desktop_config.json\` into your MCP client's config file and\n` +
        `   restart it. In Claude Desktop that file is Settings → Developer → Edit Config.\n\n` +
        `## What the assistant can do\n\n` +
        tables.map((t) => `- \`${t}\`: list, get by id, search`).join('\n') + '\n\n' +
        (allowWrites
          ? `Writes are ENABLED, so the assistant can also add and change rows. It can never DELETE.\n`
          : `This server is READ-ONLY — the assistant cannot change anything.\n`) +
        `\n## Security\n\n` +
        `It connects with your PUBLIC anon key, so your row-level security rules apply exactly as they\n` +
        `do in your app: the assistant can never see more than a signed-out visitor could. Never put a\n` +
        `service-role key here — that would bypass those rules entirely.\n`,
    },
    envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    dependencies: [
      { name: '@modelcontextprotocol/sdk', version: '^1' },
      { name: '@supabase/supabase-js', version: '^2' },
    ],
    instructions:
      `Created an MCP server exposing ${tables.length} table${tables.length === 1 ? '' : 's'} (${tables.join(', ')})` +
      `${allowWrites ? ', with writes enabled (no delete)' : ', read-only'}. ` +
      `The user connects it by pasting mcp-server/claude_desktop_config.json into Claude Desktop or Cursor — ` +
      `see mcp-server/README.md. It uses the public anon key only, so their row-level security still applies.`,
  };
}
