/**
 * Go-live PR 12 — deterministic requirements analyzer.
 *
 * Reads a generated project's file list (paths + optional package.json text) and says what it
 * needs to run: a backend, a database, auth. No LLM, no network, no clock: the same input always
 * gives the same answer, so a recommendation shown in chat can be reproduced and audited.
 * Recommendations only name SKUs that `skuOffered` allows, so an unauthorised or flag-off SKU is
 * never suggested. Not wired yet: the chat card (PR 13) calls this behind AGENTV3_SERVICE_RECO.
 */
import { skuById, skuOffered } from '../../lib/catalogue';

export interface ProjectSnapshot {
  paths: readonly string[];
  packageJson?: string | null;
}

export interface Requirements {
  needsBackend: boolean;
  needsDatabase: boolean;
  needsAuth: boolean;
  /** Human-readable, sorted evidence lines ("dependency pg", "file server.ts"). */
  evidence: string[];
}

export interface Recommendation {
  skuId: string;
  kind: 'buy' | 'connect';
  reason: string;
}

const DB_DEPS = ['pg', 'postgres', 'mysql2', 'mongodb', 'mongoose', 'prisma', '@prisma/client', 'drizzle-orm', 'knex', 'sequelize', 'typeorm', 'better-sqlite3', '@supabase/supabase-js'];
const SERVER_DEPS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', 'next'];
const AUTH_DEPS = ['next-auth', '@auth/core', 'passport', 'jsonwebtoken', 'bcrypt', 'bcryptjs', '@supabase/auth-helpers-nextjs', '@clerk/clerk-sdk-node'];
const SERVER_FILES = [/^(src\/)?server\.(t|j)s$/, /^(src\/)?api\//, /^pages\/api\//, /^app\/api\//, /^server\//];
const DB_FILES = [/^prisma\/schema\.prisma$/, /^drizzle\.config\./, /^supabase\//, /(^|\/)migrations\//, /\.sql$/];

function deps(pkg: string | null | undefined): Set<string> {
  if (!pkg) return new Set();
  try {
    const j = JSON.parse(pkg) as Record<string, unknown>;
    const out = new Set<string>();
    for (const k of ['dependencies', 'devDependencies']) {
      const d = j[k];
      if (d && typeof d === 'object') for (const n of Object.keys(d)) out.add(n);
    }
    return out;
  } catch {
    return new Set();
  }
}

export function analyzeRequirements(snap: ProjectSnapshot): Requirements {
  const d = deps(snap.packageJson);
  const paths = snap.paths.map((p) => p.replace(/^\.?\//, ''));
  const ev = new Set<string>();
  const hitDeps = (list: string[]) => list.filter((n) => d.has(n)).map((n) => { ev.add(`dependency ${n}`); return n; }).length > 0;
  const hitFiles = (res: RegExp[]) => paths.filter((p) => res.some((r) => r.test(p))).map((p) => { ev.add(`file ${p}`); return p; }).length > 0;
  const db = hitDeps(DB_DEPS) || hitFiles(DB_FILES);
  const server = hitDeps(SERVER_DEPS) || hitFiles(SERVER_FILES);
  const auth = hitDeps(AUTH_DEPS);
  return { needsBackend: server || db || auth, needsDatabase: db, needsAuth: auth, evidence: [...ev].sort() };
}

export function recommendServices(req: Requirements, env: Record<string, string | undefined> = {}): Recommendation[] {
  const out: Recommendation[] = [];
  const push = (id: string, kind: Recommendation['kind'], reason: string) => {
    if (skuOffered(skuById(id), env)) out.push({ skuId: id, kind, reason });
  };
  if (req.needsBackend) push('addon.server', 'buy', 'This app has server code, which needs a running backend.');
  if (req.needsDatabase) {
    push('addon.shared_db', 'buy', 'This app stores data, which needs a database.');
    push('byo.supabase', 'connect', 'Or connect your own Supabase project; its bill stays with you.');
  }
  return out;
}
