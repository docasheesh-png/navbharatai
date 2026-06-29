/**
 * P-AI.1 — Hallucination detection for generated code.
 *
 * A code-gen-specific hallucination lens over a generated app's files. It flags the concrete,
 * verifiable signals of an LLM "making things up":
 *   - HALLUCINATED DEPENDENCY: a bare package is imported but not declared in package.json
 *     (→ the app won't install/run — the #1 real hallucination in generated apps).
 *   - UNRESOLVED LOCAL IMPORT: `./x` resolves to no file in the project.
 *   - PLACEHOLDER / STUB: TODO/FIXME, "not implemented" throws, lorem ipsum — fake "done" code.
 * From these it derives a 0–100 confidence score + an `isLowConfidence` gate, so low-confidence
 * output can be surfaced with a warning instead of silently accepted.
 *
 * Pure + dependency-free + unit-tested. Operates on a `{ path: content }` file map (no sandbox).
 */

export type HallucinationKind = 'hallucinated-dependency' | 'unresolved-local-import' | 'placeholder-stub';

export interface HallucinationSignal {
  kind: HallucinationKind;
  file: string;
  detail: string;
}

export interface HallucinationReport {
  signals: HallucinationSignal[];
  /** 0–100; 100 = no hallucination signals. */
  confidence: number;
  /** True when confidence is below the threshold (default 70). */
  isLowConfidence: boolean;
  counts: Record<HallucinationKind, number>;
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NODE_BUILTINS = new Set([
  'fs', 'path', 'http', 'https', 'crypto', 'os', 'util', 'stream', 'events', 'url', 'querystring',
  'child_process', 'net', 'tls', 'dns', 'zlib', 'buffer', 'process', 'assert', 'module', 'readline',
  'worker_threads', 'cluster', 'perf_hooks', 'async_hooks', 'timers', 'string_decoder', 'punycode', 'v8', 'vm',
]);
const PLACEHOLDER_RE = /\b(TODO|FIXME)\b|not[\s-]?implemented|lorem ipsum|throw new Error\(['"`][^'"`]*not implemented/i;

/** Extract import/require specifiers from a source file. */
export function extractSpecifiers(content: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,  // import x from 'y' / import 'y'
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,                 // require('y')
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,                  // dynamic import('y')
    /export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g, // re-export from 'y'
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** The npm package name from a specifier (handles @scope/name and pkg/subpath). */
export function packageName(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

function declaredDeps(files: Record<string, string>): Set<string> {
  const deps = new Set<string>();
  const pkgRaw = files['package.json'];
  if (!pkgRaw) return deps;
  try {
    const pkg = JSON.parse(pkgRaw);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const obj = pkg[field];
      if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) deps.add(k);
    }
  } catch { /* malformed package.json → treat as no declared deps */ }
  return deps;
}

/** Resolve a relative import against the file set (tries common extensions + index files). */
function resolvesLocally(fromFile: string, spec: string, fileSet: Set<string>): boolean {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
  const parts = (dir ? `${dir}/${spec}` : spec).split('/');
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  const base = stack.join('/');
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
    `${base}.json`, `${base}.css`, `${base}.scss`,
  ];
  return candidates.some((c) => fileSet.has(c));
}

const WEIGHTS: Record<HallucinationKind, number> = {
  'hallucinated-dependency': 15,
  'unresolved-local-import': 12,
  'placeholder-stub': 6,
};

export interface DetectOptions { threshold?: number }

/** Analyze a generated app's files for hallucination signals. Pure. */
export function detectHallucinations(files: Record<string, string>, opts: DetectOptions = {}): HallucinationReport {
  const threshold = opts.threshold ?? 70;
  const deps = declaredDeps(files);
  const fileSet = new Set(Object.keys(files));
  const signals: HallucinationSignal[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    if (CODE_FILE.test(path)) {
      for (const spec of extractSpecifiers(content)) {
        if (spec.startsWith('.') || spec.startsWith('/')) {
          if (!resolvesLocally(path, spec, fileSet)) {
            signals.push({ kind: 'unresolved-local-import', file: path, detail: spec });
          }
        } else {
          const pkg = packageName(spec);
          if (NODE_BUILTINS.has(pkg) || pkg.startsWith('node:')) continue;
          if (!deps.has(pkg)) {
            signals.push({ kind: 'hallucinated-dependency', file: path, detail: pkg });
          }
        }
      }
    }
    if (PLACEHOLDER_RE.test(content)) {
      signals.push({ kind: 'placeholder-stub', file: path, detail: 'placeholder / not-implemented marker' });
    }
  }

  const counts: Record<HallucinationKind, number> = {
    'hallucinated-dependency': 0, 'unresolved-local-import': 0, 'placeholder-stub': 0,
  };
  let penalty = 0;
  for (const s of signals) { counts[s.kind]++; penalty += WEIGHTS[s.kind]; }
  const confidence = Math.max(0, 100 - penalty);

  return { signals, confidence, isLowConfidence: confidence < threshold, counts };
}
