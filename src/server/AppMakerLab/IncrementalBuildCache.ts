// P-BRE.2 — Incremental build cache (skip-unchanged-files).
//
// A persistent per-file content-hash cache so a rebuild can tell exactly which files changed since
// last time — and, via a lightweight import graph, which files are IMPACTED (a changed file plus
// everything that imports it, transitively). The v5.0 agent already does surgical edits (it doesn't
// regenerate unchanged files), so this adds the missing persistent signal: an honest "N/M files
// unchanged" report + a Firestore-backed hash cache that survives server restarts.
//
// Pure core (hashFiles / diffHashes / buildImportGraph / impactedFiles) → unit-tested. Uses node's
// built-in `crypto` (SHA-256) — no new dependency. The Firestore store is best-effort + VITEST-skip.

import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

export type HashMap = Record<string, string>;

export interface HashDiff {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}

/** SHA-256 hex of a string. */
export function hashContent(content: string): string {
  return createHash('sha256').update(String(content ?? ''), 'utf8').digest('hex');
}

/** Hash every file's content. Pure. */
export function hashFiles(files: Record<string, string>): HashMap {
  const out: HashMap = {};
  for (const [path, content] of Object.entries(files || {})) {
    if (typeof content === 'string') out[path] = hashContent(content);
  }
  return out;
}

/** Diff a previous hash map against the current one → added / changed / removed / unchanged. Pure. */
export function diffHashes(prev: HashMap | null | undefined, curr: HashMap): HashDiff {
  const p = prev || {};
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [path, h] of Object.entries(curr)) {
    if (!(path in p)) added.push(path);
    else if (p[path] !== h) changed.push(path);
    else unchanged.push(path);
  }
  const removed = Object.keys(p).filter((path) => !(path in curr));
  return { added, changed, removed, unchanged };
}

// Resolve a relative import specifier against the importing file's directory, trying common
// extensions + index files, so the graph links real workspace files.
function resolveImport(fromPath: string, spec: string, files: Record<string, string>): string | null {
  if (!spec.startsWith('.')) return null; // bare/external import — not a workspace edge
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const parts = (dir ? `${dir}/${spec}` : spec).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.vue`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
  ];
  for (const c of candidates) if (c in files) return c;
  return null;
}

const IMPORT_RE = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Build a reverse import graph: for each file, the set of files that IMPORT it (its dependents).
 * Pure. Only resolves relative imports to real workspace files.
 */
export function buildImportGraph(files: Record<string, string>): Record<string, string[]> {
  const dependents: Record<string, Set<string>> = {};
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const spec = m[1] || m[2];
      const target = resolveImport(path, spec, files);
      if (target && target !== path) {
        (dependents[target] ||= new Set()).add(path);
      }
    }
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(dependents)) out[k] = [...v].sort();
  return out;
}

/**
 * Given the directly-changed files + the reverse import graph, return every impacted file (the
 * changed set plus all transitive dependents). Pure.
 */
export function impactedFiles(changed: string[], dependents: Record<string, string[]>): string[] {
  const impacted = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const f = queue.shift()!;
    if (impacted.has(f)) continue;
    impacted.add(f);
    for (const dep of dependents[f] || []) if (!impacted.has(dep)) queue.push(dep);
  }
  return [...impacted].sort();
}

// ── GA-4 (incremental builds) — the unified build plan ──────────────────────────────────────────
//
// The primitives above (diff + reverse import graph + impact BFS) existed but were only used to emit a
// thin "N/M unchanged" line. computeBuildPlan connects them into ONE structured plan — the changed set, the
// IMPACTED set (changed files + everything that transitively imports them = the minimal correct re-check
// scope), and whether DEPENDENCIES changed (a lockfile was added/changed → a reinstall is genuinely needed).
// This is the honest, deterministic core of incremental builds. (Actually SKIPPING work in the sandbox based
// on this plan, and a persistent artifact/node_modules cache across cold sandboxes, remain infra-blocked —
// they need real E2B sandbox/volume control, not pure logic.) PURE; unit-tested.

/** Lockfiles whose change means dependencies must be reinstalled. */
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json'];

export interface BuildPlan {
  total: number;
  unchanged: string[];
  changed: string[];
  added: string[];
  removed: string[];
  /** changed+added PLUS everything that transitively imports them — the minimal correct re-check scope. */
  impacted: string[];
  /** A lockfile was added/changed → dependencies must be reinstalled (a `node_modules` cache is stale). */
  depsChanged: boolean;
  /** Whether there was a previous build to diff against (false = first build, everything is "new"). */
  hadPrevious: boolean;
}

/** Build the unified incremental plan from the previous build's hashes + the current files. PURE. */
export function computeBuildPlan(prev: HashMap | null | undefined, files: Record<string, string>): BuildPlan {
  const curr = hashFiles(files);
  const diff = diffHashes(prev, curr);
  const graph = buildImportGraph(files);
  const impacted = impactedFiles([...diff.added, ...diff.changed], graph);
  const changedSet = new Set([...diff.added, ...diff.changed]);
  const depsChanged = LOCKFILES.some((l) => changedSet.has(l));
  return {
    total: Object.keys(curr).length,
    unchanged: diff.unchanged, changed: diff.changed, added: diff.added, removed: diff.removed,
    impacted, depsChanged,
    hadPrevious: !!prev && Object.keys(prev).length > 0,
  };
}

/** A one-line incremental narration from a plan, or '' on the first build (nothing to compare). PURE. */
export function buildPlanNarration(plan: BuildPlan): string {
  if (!plan.hadPrevious || plan.unchanged.length === 0) return '';
  const parts = [`♻️ Incremental: ${plan.unchanged.length}/${plan.total} file(s) unchanged since the last build (${plan.changed.length} changed, ${plan.added.length} new)`];
  if (plan.impacted.length > 0) parts.push(`~${plan.impacted.length} file(s) impacted by the change`);
  parts.push(plan.depsChanged ? 'dependencies changed → reinstall needed' : 'dependencies unchanged');
  return parts.join(' · ') + '.';
}

/** Firestore-backed per-workspace hash cache. VITEST-skip, best-effort, never throws. */
class IncrementalBuildCache {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  async getHashes(workspaceId: string): Promise<HashMap | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('incrementalCache').doc(workspaceId).get();
      return snap.exists ? ((snap.data()?.hashes as HashMap) ?? null) : null;
    } catch {
      return null;
    }
  }

  async setHashes(workspaceId: string, hashes: HashMap, nowIso: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('incrementalCache').doc(workspaceId).set({ hashes, updatedAt: nowIso }, { merge: false });
    } catch { /* best-effort — never block a build */ }
  }
}

export const incrementalBuildCache = new IncrementalBuildCache();
