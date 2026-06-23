// AgentV3 — Dependency Consistency analysis (additive fifth evaluate dimension).
//
// Real static scanning over the project's actual imports vs its package.json, for
// the #1 silent build-breaker: a source file imports an npm package that is NOT
// declared in package.json (install/runtime "module not found"). Also flags
// declared dependencies never imported (low severity, conservative). Findings are
// computed deterministically from real content so the `evaluate` tool can report
// concrete dependency defects for the team to fix — never a synthetic "looks fine".
//
// Pure and deterministic: no I/O. The caller (ToolDispatcher.evaluate) collects the
// external imports from the project graph and reads package.json best-effort.

export type DependencySeverity = 'high' | 'low';

export interface DependencyIssue {
  kind: 'missing' | 'unused';
  package: string;
  severity: DependencySeverity;
  detail: string;
}

const MAX_ISSUES = 50;

/** Node.js builtin modules — imports of these need no package.json entry. */
const NODE_BUILTINS = new Set<string>([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline',
  'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/**
 * Dependencies that are always implicit in a typical toolchain — never flag these
 * as "unused" even if no source file imports them directly (they are wired via
 * config, build tooling, or type-only usage). Keeps the unused check conservative.
 */
const IMPLICIT_DEPS = new Set<string>([
  'typescript', 'vite', 'eslint', 'prettier', 'tailwindcss', 'postcss',
  'autoprefixer',
]);

/**
 * Map an import specifier to its npm package name, or null if it is NOT an
 * external npm package (relative, absolute, aliased, or a Node.js builtin).
 *
 *   './x', '../y'        → null (relative)
 *   '/abs'               → null (absolute)
 *   '@/x', '~/x'         → null (path alias)
 *   'node:fs', 'fs'      → null (builtin)
 *   'react-dom/client'   → 'react-dom'
 *   '@scope/name/sub'    → '@scope/name'
 */
export function normalizeImportToPackage(spec: string): string | null {
  if (typeof spec !== 'string') return null;
  let s = spec.trim();
  if (!s) return null;
  // Strip any query/version suffix (e.g. 'pkg?worker', 'pkg&raw').
  const cut = s.search(/[?&]/);
  if (cut >= 0) s = s.slice(0, cut);
  if (!s) return null;
  // Relative or absolute imports are local, not npm packages.
  if (s.startsWith('.') || s.startsWith('/')) return null;
  // Path aliases ('@/...', '~/...') are local, not npm packages.
  if (s.startsWith('@/') || s.startsWith('~/') || s === '~') return null;
  // Node.js builtins ('node:fs' or bare 'fs') need no package.json entry.
  if (s.startsWith('node:')) return null;
  const parts = s.split('/');
  if (s.startsWith('@')) {
    // Scoped package: '@scope/name/sub/path' → '@scope/name'.
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const root = parts[0];
  if (!root) return null;
  if (NODE_BUILTINS.has(root)) return null;
  return root;
}

interface PackageManifest {
  dependencies: Set<string>;
  devDependencies: Set<string>;
  peerDependencies: Set<string>;
  optionalDependencies: Set<string>;
}

function collectNames(section: unknown): Set<string> {
  const out = new Set<string>();
  if (section && typeof section === 'object' && !Array.isArray(section)) {
    for (const name of Object.keys(section as Record<string, unknown>)) out.add(name);
  }
  return out;
}

/** True for packages we never flag as "unused" (implicit toolchain + all @types/*). */
function isImplicitDep(name: string): boolean {
  return IMPLICIT_DEPS.has(name) || name.startsWith('@types/');
}

/**
 * Compare the project's external imports against its package.json manifest.
 *
 * - `missing` (high): an imported package not declared in any of dependencies,
 *   devDependencies, peerDependencies or optionalDependencies — would break the
 *   build at install/runtime.
 * - `unused` (low): a declared `dependencies` entry no source file imports.
 *   Conservative: only `dependencies` are considered (not dev/peer/optional),
 *   and implicit toolchain packages (typescript, vite, @types/*, …) are skipped.
 *
 * On a null or unparseable manifest, returns [] — we cannot judge without one.
 */
export function analyzeDependencies(
  externalImports: string[],
  packageJsonContent: string | null,
): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonContent);
  } catch {
    return []; // no usable manifest → cannot judge dependency consistency
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const pkg = parsed as Record<string, unknown>;

  const manifest: PackageManifest = {
    dependencies: collectNames(pkg.dependencies),
    devDependencies: collectNames(pkg.devDependencies),
    peerDependencies: collectNames(pkg.peerDependencies),
    optionalDependencies: collectNames(pkg.optionalDependencies),
  };
  const declared = new Set<string>([
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  ]);

  // Unique, normalized external package names actually imported.
  const importedPackages = new Set<string>();
  for (const spec of externalImports) {
    const name = normalizeImportToPackage(spec);
    if (name) importedPackages.add(name);
  }

  const issues: DependencyIssue[] = [];

  // Missing (high): imported but not declared anywhere.
  for (const name of importedPackages) {
    if (!declared.has(name)) {
      issues.push({
        kind: 'missing',
        package: name,
        severity: 'high',
        detail: `'${name}' is imported but not in package.json`,
      });
    }
  }

  // Unused (low): declared in `dependencies` but never imported (conservative).
  for (const name of manifest.dependencies) {
    if (isImplicitDep(name)) continue;
    if (!importedPackages.has(name)) {
      issues.push({
        kind: 'unused',
        package: name,
        severity: 'low',
        detail: `'${name}' is in package.json dependencies but never imported`,
      });
    }
  }

  return issues.slice(0, MAX_ISSUES);
}

/** A concise, honest dependency-consistency report for the agent (and the user). */
export function dependencySummary(issues: DependencyIssue[]): string {
  if (issues.length === 0) {
    return 'Dependency check: ✓ Dependencies consistent with package.json.';
  }
  const order: Record<DependencySeverity, number> = { high: 0, low: 1 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<DependencySeverity, number>,
  );
  const head = `Dependency check: ${issues.length} issue(s) — ` +
    (['high', 'low'] as DependencySeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const shown = sorted.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.kind}: ${x.package} — ${x.detail}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more].join('\n');
}
