// AgentV3 — DOES THE APP ACTUALLY LOAD THIS FILE? The post-build suite's missing question.
//
// 🔴 ROOT CAUSE (autopsy e706e068, School ERP, 2026-09-17). Three files sat at the project ROOT —
// `App.tsx`, `hooks/useStudents.ts`, `types/student.ts` — copies a batch repair had written under
// the wrong path. The real app was `index.html → src/main.tsx → src/App.tsx → …`, and nothing in it
// imported the copies: the browser never loaded them, `npm run build` never bundled them. Every
// post-build gate judged them anyway. The readiness scan found placeholder data in the stray hook
// and raised "2 fake/incomplete code issue(s)" as a build-breaking blocker; the incomplete-code heal
// then spent three minutes and twenty-two model calls "completing" a file the app does not have.
//
// 🔑 THE MISSING SUBSYSTEM, named in that autopsy: no gate asked whether the app LOADS a file. The
// authorship split (`buildAuthorship.ts`) asks "did this build write it?"; this asks the other
// question — "does the app reach it?" — and the two compose: a placeholder in a file we wrote AND
// the app loads is a defect; in a file the app never loads it is an observation.
//
// ⚠️ PRECISION-FIRST, and every rule below points the same way: "unreachable" may only be said when
// it is TRUE, because the cost of being wrong is asymmetric. A real page wrongly called unreachable
// has its placeholder finding demoted, and a fake page ships as done — the direction `buildAuthorship`
// calls unsafe. A stray wrongly called reachable merely keeps today's behaviour. So:
//   1. Edges are read from the SOURCE TEXT, not from the project graph — the graph indexes only
//      `import … from` and `require()`, and a route loaded with `React.lazy(() => import('./x'))`
//      would otherwise look unreachable. Static, side-effect, re-export, dynamic, require and
//      `new URL('./x', import.meta.url)` (workers) are all edges.
//   2. The verdict is NOT APPLICABLE — every file counts as loaded, today's behaviour — whenever the
//      answer could be incomplete: a file-system-routed framework (Next/Nuxt/SvelteKit/Astro/Remix,
//      where the router, not an import, loads a page); a glob import (`import.meta.glob`), which
//      loads files no static walk can enumerate; no HTML entry resolving to a real source file; a
//      snapshot that did not read every source file; or a conventional entry (`src/main.*`,
//      `src/App.*`) that the walk fails to reach, which means the walk is wrong, not the app.
//   3. Tooling, tests, configs, scripts, type declarations, public assets and server entries are
//      ROOTS: never "unreachable", because the app's HTML is not what loads them.
//
// PURE — no I/O, no clock. Never throws.

import path from 'path';
import { resolveLocalImport } from './ArchitectureAnalysis';

export interface ReachabilitySource {
  path: string;
  content: string;
}

export interface ReachabilityVerdict {
  /** False ⇒ the question could not be answered safely; every file counts as loaded. */
  applicable: boolean;
  /** Why it is or is not applicable — one line for the admin report. */
  reason: string;
  /** The files the walk started from (HTML entry scripts, server entries, tooling). */
  roots: string[];
  /** Every source file reachable from a root, roots included. Empty when not applicable. */
  reachable: ReadonlySet<string>;
  /** Source files nothing loads. Empty when not applicable. */
  unreachable: string[];
}

const NOT_APPLICABLE = (reason: string): ReachabilityVerdict => ({
  applicable: false, reason, roots: [], reachable: new Set(), unreachable: [],
});

/** The code files a walk can judge. Everything else (css, json, images, html) is never "unreachable". */
const JUDGED_SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

/** Frameworks whose router loads pages by FILENAME — no import edge exists, so a walk cannot see them. */
const FILE_SYSTEM_ROUTED = /^(nextjs|next|nuxt|sveltekit|svelte-kit|astro|remix|solid-start|qwik)$/i;

/** Files that are roots BY DESIGN — the HTML never loads them, and they are not debris. */
const ROOT_PATTERNS: RegExp[] = [
  /\.d\.ts$/i,
  /(^|\/)(vite|vitest|tailwind|postcss|playwright|jest|eslint|prettier|babel|webpack|rollup|tsup|next|astro|svelte|nuxt|capacitor|cypress|drizzle|prisma|knexfile|commitlint|lint-staged)\.config\.[cm]?[jt]sx?$/i,
  /(^|\/)\.(eslintrc|prettierrc|babelrc|stylelintrc)(\.[cm]?[jt]s)?$/i,
  /(^|\/)(test|tests|__tests__|e2e|spec|cypress|scripts|script|bin|tools|migrations|seeds?|prisma|supabase|functions|public|static|\.storybook|stories)\//i,
  /\.(test|spec|stories|story)\.[cm]?[jt]sx?$/i,
  /(^|\/)(sw|service-worker|serviceWorker|worker)\.[cm]?[jt]s$/i,
  // Server-side entries: a full-stack app has a second root the HTML never loads.
  /(^|\/)(server|backend|api|functions|worker)\/(src\/)?(index|main|server|app)\.[cm]?[jt]s$/i,
  /^(server|index|main|app)\.[cm]?[jt]s$/i,
  /^src\/server\/(index|main|server|app)\.[cm]?[jt]s$/i,
  /(^|\/)seed\.[cm]?[jt]s$/i,
  /(^|\/)setupTests\.[cm]?[jt]sx?$/i,
];

/**
 * Conventional entries the walk MUST reach — if it does not, the walk is wrong, not the app.
 *
 * ⚠️ Judged only INSIDE the directory the HTML entry points into. A root-level `App.tsx` beside an
 * `index.html` that boots `/src/main.tsx` is exactly the e706e068 stray, not an entry: applying this
 * check project-wide would withhold the verdict on the very case it exists for.
 */
const CONVENTIONAL_ENTRY = /(^|\/)(main|index|App)\.(tsx?|jsx?)$/;

function normalizePath(p: string): string {
  const n = path.posix.normalize(String(p ?? '').replace(/\\/g, '/'));
  return n.replace(/^(\.\/|\/)+/, '').replace(/\/{2,}/g, '/');
}

function isRootByDesign(p: string): boolean {
  return ROOT_PATTERNS.some((re) => re.test(p));
}

/** The specifiers a source file loads — every form a bundler follows. */
export function extractLoadSpecifiers(content: string): string[] {
  const out: string[] = [];
  const text = String(content ?? '');
  const push = (s: string | undefined) => {
    if (!s) return;
    // `./x?raw`, `./worker?worker`, `./img.png?url` — the query is Vite's, the path is the file's.
    out.push(s.replace(/[?#].*$/, ''));
  };
  const patterns: RegExp[] = [
    /\bimport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g, //  import x from 'y'
    /\bimport\s*['"]([^'"]+)['"]/g, //                    import 'y'   (side-effect)
    /\bexport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g, //  export * from 'y' / export { a } from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //          import('y')  (React.lazy, routes)
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //         require('y')
    /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g, // new URL('./w', import.meta.url)
  ];
  for (const re of patterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) push(m[1]);
  }
  return out;
}

/** `<script … src="/src/main.tsx">` targets in an HTML entry, resolved against the file set. */
export function htmlEntryScripts(htmlPath: string, html: string, files: Set<string>): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  const dir = htmlPath.includes('/') ? htmlPath.slice(0, htmlPath.lastIndexOf('/')) : '';
  for (let m = re.exec(String(html ?? '')); m; m = re.exec(String(html ?? ''))) {
    const raw = m[1].replace(/[?#].*$/, '');
    if (/^(https?:)?\/\//i.test(raw)) continue; // a CDN script is not a project file
    const candidates = raw.startsWith('/')
      ? [normalizePath(raw)]
      : [normalizePath(dir ? `${dir}/${raw}` : raw), normalizePath(raw)];
    for (const c of candidates) {
      if (files.has(c)) { out.push(c); break; }
      const viaResolver = resolveLocalImport(htmlPath || 'index.html', c.startsWith('.') ? c : `./${c}`, files);
      if (viaResolver) { out.push(viaResolver); break; }
    }
  }
  return [...new Set(out)];
}

/**
 * Which source files does the app load?
 *
 * `sources` must be EVERY judged source file with its content; pass `listedSourcePaths` (the full
 * file listing, filtered to code) so a snapshot that could not read everything is detected and the
 * verdict withheld rather than computed on a partial graph.
 */
export function computeReachability(
  sources: ReadonlyArray<ReachabilitySource> | null | undefined,
  opts: { framework?: string | null; listedSourcePaths?: ReadonlyArray<string> | null } = {},
): ReachabilityVerdict {
  const src = (Array.isArray(sources) ? sources : []).filter((s) => s && typeof s.path === 'string');
  const byPath = new Map<string, string>();
  for (const s of src) byPath.set(normalizePath(s.path), String(s.content ?? ''));
  const files = new Set(byPath.keys());
  const judged = [...files].filter((p) => JUDGED_SOURCE.test(p));
  if (judged.length === 0) return NOT_APPLICABLE('no code files to judge');

  const fw = String(opts.framework ?? '').trim();
  if (fw && FILE_SYSTEM_ROUTED.test(fw)) return NOT_APPLICABLE(`${fw} loads pages by filename, not by import`);
  if (judged.some((p) => /(^|\/)(app|pages)\/(?:.*\/)?(layout|page|route|_app|_document)\.[cm]?[jt]sx?$/i.test(p))) {
    return NOT_APPLICABLE('file-system routing detected (app/ or pages/ special files)');
  }
  if (judged.some((p) => /\.(vue|svelte|astro)$/i.test(p)) || [...files].some((p) => /\.(vue|svelte|astro)$/i.test(p))) {
    return NOT_APPLICABLE('single-file-component framework — edges are not plain imports');
  }
  if (opts.listedSourcePaths) {
    const listed = opts.listedSourcePaths.map(normalizePath).filter((p) => JUDGED_SOURCE.test(p));
    const missing = listed.filter((p) => !files.has(p));
    if (missing.length > 0) return NOT_APPLICABLE(`${missing.length} source file(s) were not read — the graph would be incomplete`);
  }
  for (const p of judged) {
    if (/\bimport\.meta\.glob\s*\(/.test(byPath.get(p) ?? '')) return NOT_APPLICABLE(`${p} uses import.meta.glob — loaded files cannot be enumerated statically`);
  }

  // Roots: every HTML entry's scripts, plus everything that is a root by design.
  const roots = new Set<string>();
  const htmlFiles = [...files].filter((p) => /\.html?$/i.test(p) && !/(^|\/)(dist|build|public)\//i.test(p));
  let entryScripts = 0;
  for (const h of htmlFiles) {
    for (const s of htmlEntryScripts(h, byPath.get(h) ?? '', files)) { roots.add(s); entryScripts++; }
  }
  if (entryScripts === 0) return NOT_APPLICABLE('no HTML entry loads a source file — the app\'s entry is unknown');
  for (const p of judged) if (isRootByDesign(p)) roots.add(p);

  // The walk.
  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.pop() as string;
    if (reachable.has(cur)) continue;
    reachable.add(cur);
    const content = byPath.get(cur);
    if (!content || !JUDGED_SOURCE.test(cur)) continue;
    for (const spec of extractLoadSpecifiers(content)) {
      const to = resolveLocalImport(cur, spec, files);
      if (to && !reachable.has(to)) queue.push(to);
    }
  }

  const unreachable = judged.filter((p) => !reachable.has(p)).sort();
  const entryDirs = new Set([...roots].filter((r) => byPath.has(r) && !isRootByDesign(r)).map((r) => (r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : '')));
  const entryMissed = unreachable.find((p) => CONVENTIONAL_ENTRY.test(p) && entryDirs.has(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''));
  if (entryMissed) return NOT_APPLICABLE(`the walk did not reach ${entryMissed}, a conventional entry — the graph is incomplete`);

  return {
    applicable: true,
    reason: `walked ${reachable.size} file(s) from ${roots.size} root(s); ${unreachable.length} code file(s) nothing loads`,
    roots: [...roots].sort(),
    reachable,
    unreachable,
  };
}

/** Is this file one the app never loads? Always false when the verdict is not applicable. */
export function isUnreachable(v: ReachabilityVerdict | null | undefined, file: string | null | undefined): boolean {
  if (!v || !v.applicable) return false;
  const p = normalizePath(String(file ?? ''));
  if (!p || !JUDGED_SOURCE.test(p)) return false;
  return !v.reachable.has(p);
}

/**
 * Split findings into the ones about files the app LOADS and the ones about files it never does.
 * A finding with no file cannot be placed and stays `loaded` (the same safe direction as
 * `splitByAuthorship`); a not-applicable verdict returns everything as `loaded`.
 */
export function splitByReachability<T extends { file?: string | null }>(
  findings: ReadonlyArray<T> | null | undefined,
  v: ReachabilityVerdict | null | undefined,
): { loaded: T[]; unloaded: T[] } {
  const all = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const loaded: T[] = [];
  const unloaded: T[] = [];
  for (const f of all) (isUnreachable(v, f?.file) ? unloaded : loaded).push(f);
  return { loaded, unloaded };
}

/** The wording for a finding about a file the app never loads — mirrors `preExistingCodeObservation`. */
export function unreachableCodeObservation(label: string): string {
  return `[observation about files the app never loads — nothing imports them from its entry] ${label}`;
}
