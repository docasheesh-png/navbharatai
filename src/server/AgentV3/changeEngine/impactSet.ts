// CHANGE ENGINE slice 4 — which files will this change touch, and what else depends on them? Decided
// BEFORE the builder writes a line, from the app's own import graph.
//
// WHY (2026-10-04). The import graph has existed since A1 (`codeGraph.ts`: `impactOf`, `whoImports`), but
// it is reachable only through the `code_graph` tool — so the builder learns what depends on a file only if
// it thinks to ask, usually after it has already edited it. On a cross-cutting change that is how a
// working screen breaks: the edit is correct for the file in front of the model and wrong for the three
// files that import it.
//
// This module computes the answer up front, deterministically and for ₹0:
//   1. SEEDS — files the request is plainly about: a word in the request matches a word in the file's
//      name ("coupon on the cart page" → CartPage.tsx), plus, for a change KIND that always reaches a
//      known place (a theme, auth, data), the files that conventionally hold it.
//   2. DEPENDENTS — every file that imports a seed, directly or transitively (`impactOf`).
//
// It is a HINT about where to look, never a restriction and never a claim: a request that names no file
// yields nothing, and the block says the list was derived, so the builder still reads before it edits.
// PURE.

import { impactOf } from '../codeGraph';
import type { ProjectGraph } from '../WorkspaceMemory';
import type { ChangeKind } from './changeClassifier';

export interface ImpactSet {
  seeds: string[];
  dependents: string[];
}

const MAX_SEEDS = 12;
const MAX_DEPENDENTS = 20;

/** Words too common in requests or file names to say anything about WHICH file. */
const STOP = new Set([
  'the', 'and', 'add', 'make', 'with', 'from', 'that', 'this', 'into', 'page', 'pages', 'screen', 'screens',
  'button', 'buttons', 'please', 'want', 'need', 'should', 'have', 'also', 'more', 'some', 'show', 'when',
  'there', 'their', 'them', 'they', 'your', 'mera', 'meri', 'karo', 'kardo', 'chahiye', 'index', 'main',
  'component', 'components', 'file', 'files', 'app', 'apps', 'src', 'new', 'all', 'every', 'change', 'update',
]);

/** Where a change of a given kind conventionally lands, by file-name pattern. */
const KIND_PATHS: Partial<Record<ChangeKind, RegExp>> = {
  'cross-cutting': /(^|\/)(app|layout|theme|themes?context|navbar|nav|header|sidebar|routes?|router)\.[jt]sx?$|(^|\/)(index|globals?|app)\.css$|tailwind\.config\./i,
  integration: /(auth|login|signin|session|firebase|supabase|oauth|payment|checkout|api|client)/i,
  data: /(db|database|schema|model|models|store|supabase|firebase|firestore|prisma|api|repository|service)/i,
  security: /(auth|middleware|server|api|guard|permission|role|env)/i,
  architectural: /(^|\/)(main|index|app)\.[jt]sx?$|(^|\/)(vite|next|tsconfig|package)\b/i,
};

/** Split a path's file name into lowercase words: "src/pages/CartPage.tsx" → ["cart", "page"]. */
export function nameWords(path: string): string[] {
  const base = path.split('/').pop() || '';
  const stem = base.replace(/\.[^.]+$/, '');
  return stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3);
}

function requestWords(request: string): Set<string> {
  const out = new Set<string>();
  for (const w of request.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(w);
    // A crude singular so "orders" finds Order.tsx and "carts" finds Cart.tsx.
    if (w.endsWith('s') && w.length > 4) out.add(w.slice(0, -1));
  }
  return out;
}

const IS_SOURCE = /\.(tsx?|jsx?|vue|svelte|css)$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|\.git|coverage)\//;

/** Compute the impact set for a request. Pure; never throws; empty when nothing is plainly named. */
export function computeImpactSet(request: string, graph: ProjectGraph | null | undefined, kinds: ReadonlyArray<ChangeKind>): ImpactSet {
  const empty: ImpactSet = { seeds: [], dependents: [] };
  if (!graph || !Array.isArray(graph.files) || graph.files.length === 0 || typeof request !== 'string') return empty;
  const files = graph.files.filter((f) => IS_SOURCE.test(f) && !IGNORED.test(f) && !/\.(test|spec)\.[jt]sx?$/.test(f));
  const words = requestWords(request);
  const seeds = new Set<string>();
  for (const f of files) {
    if (nameWords(f).some((w) => words.has(w))) seeds.add(f);
  }
  for (const k of kinds) {
    const re = KIND_PATHS[k];
    if (!re) continue;
    for (const f of files) if (re.test(f)) seeds.add(f);
  }
  // A request that matches half the app named nothing in particular — say nothing rather than everything.
  if (seeds.size === 0 || (files.length >= 10 && seeds.size > files.length / 2)) return empty;
  const seedList = [...seeds].sort().slice(0, MAX_SEEDS);
  const dependents = new Set<string>();
  for (const s of seedList) {
    let hits: string[] = [];
    try { hits = impactOf(graph, s); } catch { hits = []; }
    for (const d of hits) if (!seeds.has(d)) dependents.add(d);
  }
  return { seeds: seedList, dependents: [...dependents].sort().slice(0, MAX_DEPENDENTS) };
}

/** The builder-facing block. '' when the set is empty. */
export function renderImpactForBuilder(set: ImpactSet): string {
  if (set.seeds.length === 0) return '';
  const out = [
    'LIKELY AFFECTED FILES (derived from this app\'s file names and import graph — a map of where to look, not a limit on what you may change):',
    ...set.seeds.map((f) => `  • ${f}`),
  ];
  if (set.dependents.length > 0) {
    out.push('These files IMPORT the ones above, so a change to their exports can break them — check them after editing:');
    out.push(...set.dependents.map((f) => `  • ${f}`));
  }
  return out.join('\n');
}
