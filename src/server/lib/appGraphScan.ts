// Full-App Debugger — cross-file / dependency-GRAPH analyzer (admin: "mythos-level" debugger, 2026-07-24).
//
// The static scanner reads one line at a time; the AI pass reads one file at a time. Neither
// understands the app as a SYSTEM. This layer builds the real module graph from the actual
// import/require/export statements and finds the class of bugs that only exist BETWEEN files — the
// ones that crash a real app at build or first run:
//
//   • MISSING_DEPENDENCY   — a package is imported but not declared in package.json (npm install won't
//                            fetch it → "Cannot find module" at runtime).
//   • BROKEN_IMPORT        — a relative import points at a file that doesn't exist in the project.
//   • DEAD_FILE            — a source file nothing else imports (possible dead code).
//
// These are DETERMINISTIC and precise (file:line), so they carry the same "verified" trust as the
// static scanner — never AI-guessed. HONESTY is enforced by construction: the whole-graph checks
// (BROKEN_IMPORT / DEAD_FILE) only run when the caller confirms the file set is COMPLETE (a Pro v5
// app's durable files), and even then only when there is positive evidence we actually have the target
// area — so a truncated GitHub fetch can never produce a false "this file is missing".
//
// Pure (no I/O) → fully unit-testable. No provider names anywhere (white-label).

import type { AppFinding } from './appDebugAnalysis';
import type { FindingSeverity } from './appStaticScan';

const JS_TS_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/i;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.svelte'];

/** Node core modules — importing these is never a missing dependency. */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

export interface RawImport { spec: string; line: number; }

/** Extract every import/require/dynamic-import specifier from a file, with its 1-based line. */
export function extractImports(content: string): RawImport[] {
  const out: RawImport[] = [];
  const lines = String(content || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.length > 600) continue; // skip minified/generated lines
    const line = i + 1;
    const from = /\bfrom\s*['"]([^'"]+)['"]/.exec(raw);
    if (from) out.push({ spec: from[1], line });
    const bare = /^\s*import\s+['"]([^'"]+)['"]/.exec(raw); // side-effect import 'x'
    if (bare) out.push({ spec: bare[1], line });
    const re = /\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) out.push({ spec: m[1], line });
  }
  return out;
}

export type SpecKind = 'relative' | 'bare' | 'alias' | 'builtin' | 'absolute';

/** Classify an import specifier. Aliases (@/…, ~/…) are configured paths, never a missing dep. */
export function classifySpec(spec: string): SpecKind {
  if (!spec) return 'absolute';
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') return 'relative';
  if (spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('~')) return 'alias';
  if (spec.startsWith('/')) return 'absolute';
  const root = spec.startsWith('node:') ? spec.slice(5).split('/')[0] : spec.split('/')[0];
  if (NODE_BUILTINS.has(root) || spec.startsWith('node:')) return 'builtin';
  return 'bare';
}

/** The npm package root of a bare specifier: `lodash/merge` → `lodash`, `@scope/pkg/x` → `@scope/pkg`. */
export function packageRoot(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** Normalize a '/'-separated path, resolving `.` and `..` segments. No leading slash. */
export function normalizePath(p: string): string {
  const stack: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (stack.length && stack[stack.length - 1] !== '..') stack.pop(); else stack.push('..'); }
    else stack.push(seg);
  }
  return stack.join('/');
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** Resolve a relative import to an existing file in the map. Returns the matched path or null. */
export function resolveRelative(fromFile: string, spec: string, fileSet: Set<string>): string | null {
  const base = dirOf(fromFile);
  const target = normalizePath(base ? `${base}/${spec}` : spec);
  // Exact path (spec already carried an extension).
  if (fileSet.has(target)) return target;
  for (const ext of RESOLVE_EXTS) if (fileSet.has(target + ext)) return target + ext;
  for (const ext of RESOLVE_EXTS) if (fileSet.has(`${target}/index${ext}`)) return `${target}/index${ext}`;
  return null;
}

/** The declared dependency roots from a package.json's text (all dep buckets + the package's own name). */
export function declaredDependencies(pkgJsonText: string): { deps: Set<string>; selfName: string } {
  const deps = new Set<string>();
  let selfName = '';
  try {
    const pkg = JSON.parse(pkgJsonText) as Record<string, unknown>;
    if (typeof pkg.name === 'string') selfName = pkg.name;
    for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies']) {
      const b = pkg[bucket];
      if (b && typeof b === 'object') for (const k of Object.keys(b as object)) deps.add(k);
      if (Array.isArray(b)) for (const k of b) if (typeof k === 'string') deps.add(k);
    }
  } catch { /* unparseable package.json → treat as no declared deps (caller still gated on existence) */ }
  return { deps, selfName };
}

const ENTRY_RE = /(^|\/)(main|index|app|server|vite\.config|next\.config|setup|entry)\.[jt]sx?$/i;
const NEVER_DEAD_RE = /(^|\/)(pages|app|routes|api|migrations|scripts|public)\//i;
const TYPE_DECL_RE = /\.d\.ts$/i;
const CONFIG_LIKE_RE = /(^|\/)[^/]*\.config\.[jt]s$|(^|\/)(vite|next|webpack|rollup|jest|vitest|tailwind|postcss|babel)\.[^/]+$/i;

/**
 * Build the module-graph findings for a whole app.
 * @param files       the project's `{path: content}` map.
 * @param completeFileset  true only when the caller knows every file is present (a Pro v5 app's durable
 *                    store). The whole-graph checks (broken imports, dead files) run ONLY when true —
 *                    a partial/truncated fetch can never yield a false "missing file".
 */
export function scanAppGraph(files: Record<string, string>, completeFileset: boolean): AppFinding[] {
  const paths = Object.keys(files || {});
  const fileSet = new Set(paths);
  const codePaths = paths.filter((p) => JS_TS_RE.test(p));

  // package.json (prefer the shallowest one — the app root).
  const pkgPath = paths
    .filter((p) => p === 'package.json' || p.endsWith('/package.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const declared = pkgPath ? declaredDependencies(files[pkgPath]) : null;

  const findings: AppFinding[] = [];
  const reportedMissing = new Set<string>();      // dedupe missing-dep by package root (once, globally)
  const importedTargets = new Set<string>();      // resolved relative targets that exist (for dead-file)

  for (const file of codePaths) {
    const imports = extractImports(files[file]);
    const seenSpec = new Set<string>();
    for (const { spec, line } of imports) {
      if (seenSpec.has(spec)) continue;
      seenSpec.add(spec);
      const kind = classifySpec(spec);

      if (kind === 'bare' && declared) {
        const root = packageRoot(spec);
        if (root && root !== declared.selfName && !declared.deps.has(root) && !reportedMissing.has(root)) {
          reportedMissing.add(root);
          findings.push({
            severity: 'high', file, line, category: 'dependency', source: 'graph',
            problem: `"${root}" is imported but is not listed in package.json — a fresh install won't fetch it, so the app will fail with "Cannot find module '${root}'".`,
            suggestion: `Add "${root}" to package.json dependencies (e.g. run npm install ${root}), or remove the import if it's unused.`,
          });
        }
      } else if (kind === 'relative') {
        const resolved = resolveRelative(file, spec, fileSet);
        if (resolved) {
          importedTargets.add(resolved);
        } else if (completeFileset) {
          // Only flag when we have evidence we actually hold the target's directory.
          const base = dirOf(file);
          const targetDir = dirOf(normalizePath(base ? `${base}/${spec}` : spec));
          const haveArea = paths.some((p) => (dirOf(p) === targetDir) || (targetDir && p.startsWith(`${targetDir}/`)));
          if (haveArea || targetDir === base) {
            findings.push({
              severity: 'high', file, line, category: 'imports', source: 'graph',
              problem: `Import "${spec}" does not resolve to any file in the project — this is a broken import that will fail the build.`,
              suggestion: 'Fix the path, create the missing file, or remove the import. Check for a typo or a wrong relative depth (../).',
            });
          }
        }
      }
    }
  }

  // DEAD_FILE — a source file nothing imports (conservative; complete file sets only).
  if (completeFileset) {
    for (const file of codePaths) {
      if (importedTargets.has(file)) continue;
      if (ENTRY_RE.test(file) || NEVER_DEAD_RE.test(file) || TYPE_DECL_RE.test(file) || CONFIG_LIKE_RE.test(file)) continue;
      if (/\.(test|spec|stories)\./.test(file)) continue;
      findings.push({
        severity: 'low', file, line: 1, category: 'maintainability', source: 'graph',
        problem: 'This file does not appear to be imported anywhere in the project — it may be dead code.',
        suggestion: 'Confirm it is truly unused (watch for dynamic imports or framework auto-loading), then remove it to reduce surface area.',
      });
    }
  }

  return findings;
}

/** Convenience for callers that don't care about the severity split. */
export function graphSeverityCounts(findings: AppFinding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
