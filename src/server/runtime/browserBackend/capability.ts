// PHASE 2 slice 1 — the gate that decides whether a backend may run in the browser at all.
//
// THE RULE, AND IT IS THE WHOLE DESIGN: the default answer is NO.
//
// `expressShim.ts` can genuinely run an Express app's own route handlers. It cannot run everything an
// Express app might do, and the difference between those two sentences is where a "built but not really
// working" feature would be born. So this module does not ask "does anything look unsupported?" — it
// asks "is EVERY import on the supported list?", and one unknown name sends the whole app to the
// sandbox, where the real Express and the real Node are.
//
// That asymmetry is deliberate and permanent:
//   • a wrong NO costs one sandbox — today's cost, no regression, nobody notices;
//   • a wrong YES silently answers a user's API calls with something that is not their server, and the
//     app looks like it works. That is the second absolute rule's exact prohibition, and it is worth
//     far more than a VM.
//
// Adding a name to SUPPORTED_MODULES is therefore not a tidy-up. It is a claim that the shim runs that
// module FAITHFULLY, and it needs a test that proves it before the name goes in.
//
// PURE and deterministic — file map in, verdict out. No I/O, no model call, no cost.

/** Why this backend cannot be trusted to the browser. */
export type BackendBlocker =
  /** An import we do not implement. The default outcome for anything unrecognised. */
  | 'unsupported-import'
  /**
   * A database driver we do NOT speak. `pg` is no longer one of these — pgShim.ts runs real Postgres
   * (PGlite) in the browser. The rest generate SQL and run migrations through their own engines, and a
   * half-supported migration tool produces a schema that is subtly not the user's.
   */
  | 'needs-database'
  /** Reaches for the machine: the filesystem, a child process, a socket, the clock as a scheduler. */
  | 'needs-machine'
  /** No server entry could be identified, so there is nothing to prove anything about. */
  | 'no-server-entry';

export interface BackendCapability {
  /** TRUE only when a server entry was found AND every one of its imports is supported. */
  runnable: boolean;
  /** The entry we would run, when one was identified. */
  entry: string | null;
  blockers: BackendBlocker[];
  /** The specific import names that caused a refusal — so the honest message can name them. */
  unsupported: string[];
  /** Every bare import the server graph makes. The renderer ships a shim only for what is used. */
  imports: string[];
  /** One user-facing sentence. Empty when runnable. Never names a vendor (the white-label law). */
  reason: string;
}

/**
 * Modules the shim implements faithfully, or that are pure JS and run in a browser unchanged.
 *
 * `express` is ours. `cors` / `morgan` / `compression` / `helmet` are HTTP middleware whose effect is
 * headers and logging — in a browser bridge they are genuinely inert, and inert is the truthful outcome
 * rather than an approximated one. The rest (`bcryptjs`, `jsonwebtoken`, `zod`, `uuid`, `dayjs`, …) are
 * ordinary JavaScript libraries that already work in a browser; they are listed, not assumed, so the
 * list stays a decision rather than a default.
 *
 * ⚠️ `bcryptjs` is here and `bcrypt` is NOT: the first is pure JS, the second is a native binding.
 * They differ by three characters and by whether the app runs at all.
 */
const SUPPORTED_MODULES = new Set([
  'express', 'cors', 'morgan', 'compression', 'helmet', 'body-parser', 'cookie-parser',
  'bcryptjs', 'jsonwebtoken', 'jose', 'zod', 'yup', 'joi', 'validator',
  'uuid', 'nanoid', 'dayjs', 'date-fns', 'lodash', 'lodash-es', 'ramda',
  'axios', 'node-fetch', 'cross-fetch', 'qs', 'slugify', 'ms', 'debug', 'dotenv',
  // `pg` is REAL here, not approximated: pgShim.ts implements node-postgres over PGlite — Postgres
  // itself compiled to WebAssembly — and its tests execute the actual database, so a constraint that
  // would fail on a server fails in the preview too. It earns its place on this list the way the
  // header demands: by a test proving faithfulness, not by looking harmless.
  'pg',
]);

/** Database drivers — real, and not ours yet. Named separately so the refusal can say WHY. */
const DATABASE_MODULES = new Set([
  // `pg` is DELIBERATELY absent — see SUPPORTED_MODULES. Everything below generates SQL through its own
  // engine and runs migrations through its own CLI, and half-supporting a migration tool produces a
  // schema that is subtly not the user's. Those apps keep the sandbox, where the real toolchain is.
  'postgres', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'mongodb', 'mongoose',
  '@prisma/client', 'prisma', 'drizzle-orm', 'typeorm', 'sequelize', 'knex', 'redis', 'ioredis',
]);

/** Machine access. A browser has none of it, and pretending otherwise produces silent wrong data. */
const MACHINE_MODULES = new Set([
  'fs', 'fs/promises', 'path', 'os', 'child_process', 'cluster', 'worker_threads', 'net', 'dns', 'tls',
  'http', 'https', 'http2', 'crypto', 'zlib', 'readline', 'vm', 'perf_hooks', 'stream', 'events',
  'multer', 'sharp', 'nodemailer', 'node-cron', 'node-schedule', 'socket.io', 'ws', 'puppeteer',
]);

const SERVER_ENTRY = /(^|\/)(server|backend|api)\/(index|server|app|main)\.[cm]?[jt]s$/i;
const SERVER_ROOT_ENTRY = /^(server|app|index|main)\.[cm]?[jt]s$/i;
const IMPORT_RE = /(?:^|[\s;{(=])(?:import\s+(?:[\w*{},\s]+\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

/** Reduce a specifier to its package name: 'lodash/get' → 'lodash', '@scope/pkg/x' → '@scope/pkg'. */
export function packageName(spec: string): string {
  const s = String(spec || '').replace(/^node:/, '');
  const parts = s.split('/');
  return s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Every bare (non-relative) import a file makes. Pure. */
export function bareImports(source: string): string[] {
  const out = new Set<string>();
  for (const m of String(source || '').matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
    out.add(packageName(spec));
  }
  return [...out].sort();
}

/**
 * Find the app's server entry. Deliberately narrow: a file under `server/`, `backend/` or `api/`, or a
 * root-level `server.js`/`app.js` that actually imports express.
 *
 * `src/**` is excluded on purpose — `src/api/client.ts` is a browser fetch helper, not a server, and
 * treating it as one would have us "run" a file that never was a backend. Same rule `builtAServer` uses
 * in serverNecessity.ts, so the two cannot disagree about what a server is.
 */
export function findServerEntry(files: Record<string, string>): string | null {
  const paths = Object.keys(files || {});
  const nested = paths.filter((p) => SERVER_ENTRY.test(p) && !/^src\//i.test(p)).sort((a, b) => a.length - b.length);
  if (nested.length > 0) return nested[0];
  const root = paths.filter((p) => SERVER_ROOT_ENTRY.test(p) && /express/.test(files[p] || ''));
  return root.sort((a, b) => a.length - b.length)[0] ?? null;
}

/**
 * Every file the server entry reaches, following RELATIVE imports only.
 *
 * Bounded and cycle-safe: a route file importing a controller importing the route file back is ordinary
 * in Express apps, and an unbounded walk over that is a hang rather than a verdict.
 */
export function serverModuleGraph(files: Record<string, string>, entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const EXT = ['', '.js', '.ts', '.mjs', '.cjs', '/index.js', '/index.ts'];
  while (queue.length > 0 && seen.size < 500) {
    const cur = queue.shift()!;
    if (seen.has(cur) || typeof files[cur] !== 'string') continue;
    seen.add(cur);
    const dir = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/')) : '';
    for (const m of String(files[cur]).matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (!spec || !spec.startsWith('.')) continue;
      const parts = `${dir}/${spec}`.split('/');
      const stack: string[] = [];
      for (const seg of parts) {
        if (seg === '.' || seg === '') continue;
        if (seg === '..') stack.pop();
        else stack.push(seg);
      }
      const base = stack.join('/');
      for (const ext of EXT) {
        if (typeof files[base + ext] === 'string') { queue.push(base + ext); break; }
      }
    }
  }
  return [...seen];
}

const REASON: Record<BackendBlocker, string> = {
  'unsupported-import': 'this app’s server uses features NavBharatAI can’t run in the browser yet',
  'needs-database': 'this app’s server talks to a database, which the live server has to run',
  'needs-machine': 'this app’s server needs a real machine — files, processes or scheduled jobs',
  'no-server-entry': 'no server could be identified to run',
};

/**
 * Can this app's backend be run in the browser? Pure. The default answer is NO.
 *
 * Blockers are collected rather than short-circuited, so the report can say "and also" and so a caller
 * measuring what stands in the way sees the whole picture instead of whichever check ran first.
 */
export function proveBackendRunnable(files: Record<string, string> | null | undefined): BackendCapability {
  const map = files && typeof files === 'object' ? files : {};
  const entry = findServerEntry(map);
  if (!entry) {
    return { runnable: false, entry: null, blockers: ['no-server-entry'], unsupported: [], imports: [], reason: REASON['no-server-entry'] };
  }

  const imports = new Set<string>();
  for (const file of serverModuleGraph(map, entry)) {
    for (const name of bareImports(map[file])) imports.add(name);
  }

  const blockers = new Set<BackendBlocker>();
  const unsupported: string[] = [];
  for (const name of [...imports].sort()) {
    if (SUPPORTED_MODULES.has(name)) continue;
    if (DATABASE_MODULES.has(name)) { blockers.add('needs-database'); unsupported.push(name); continue; }
    if (MACHINE_MODULES.has(name)) { blockers.add('needs-machine'); unsupported.push(name); continue; }
    // THE DEFAULT. An unrecognised name is not "probably fine" — it is unproven, and unproven means the
    // sandbox. Every name that ever leaves this branch does so by being added to SUPPORTED_MODULES with
    // a test behind it.
    blockers.add('unsupported-import');
    unsupported.push(name);
  }

  // Express itself must actually be there. A "server" that never imports it is not something this shim
  // can claim to run, whatever else its imports look like.
  if (!imports.has('express')) { blockers.add('unsupported-import'); }

  const list = [...blockers];
  return {
    runnable: list.length === 0,
    entry,
    blockers: list,
    unsupported,
    imports: [...imports].sort(),
    reason: list.length === 0 ? '' : REASON[list[0]],
  };
}
