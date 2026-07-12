// AgentV3 — Dependency Consistency analysis (additive fifth evaluate dimension).
//
// Real static scanning over the project's actual imports vs its package.json, for
// the #1 silent build-breaker: a source file imports an npm package that is NOT
// declared in package.json (install/runtime "module not found"). Also flags
// declared dependencies never imported (low severity, conservative) and
// dependencies pinned to a floating, non-reproducible version (`*` / `latest` /
// `x` / empty — medium), the classic "worked yesterday, broke on reinstall" trap.
// Findings are computed deterministically from real content so the `evaluate` tool
// can report concrete dependency defects for the team to fix — never a synthetic
// "looks fine".
//
// Pure and deterministic: no I/O. The caller (ToolDispatcher.evaluate) collects the
// external imports from the project graph and reads package.json best-effort.

// `semver` (installed, 7.x) ships no bundled types and @types/semver isn't a dependency; the tiny
// surface we use is declared ambiently in ./semver.d.ts so the version-conflict analyzer stays typed.
import { validRange, intersects } from 'semver';

export type DependencySeverity = 'high' | 'medium' | 'low';

export interface DependencyIssue {
  kind: 'missing' | 'unused' | 'unpinned' | 'version-conflict' | 'peer-violation';
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
 * Version specifiers that pin nothing — every `npm install` can resolve to a
 * different release, so a transitive breaking change silently breaks a build that
 * worked yesterday. Matched case-insensitively against the trimmed version string,
 * so special protocols (`workspace:*`, `file:..`, git/url refs, `npm:pkg@1`) and
 * partially-locked ranges (`1.x`, `^1.2`, `~1.2`) are intentionally NOT flagged.
 */
const UNPINNED_VERSIONS = new Set<string>(['*', 'latest', 'x', '']);

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

/** Collect [name, versionSpec] pairs from a manifest section (string versions only). */
function collectVersionEntries(section: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (section && typeof section === 'object' && !Array.isArray(section)) {
    for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
      if (typeof version === 'string') out.push([name, version]);
    }
  }
  return out;
}

/** True for a floating/non-reproducible version specifier (`*`, `latest`, `x`, ''). */
function isUnpinnedVersion(version: string): boolean {
  return UNPINNED_VERSIONS.has(version.trim().toLowerCase());
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
 * - `unpinned` (medium): a `dependencies`/`devDependencies` entry whose version is
 *   floating (`*` / `latest` / `x` / empty) — builds are not reproducible.
 *   `peerDependencies`/`optionalDependencies` are skipped (a `*` peer range is
 *   normal), as are special protocols and partially-locked ranges (see
 *   UNPINNED_VERSIONS).
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

  // Unpinned (medium): a floating version in dependencies/devDependencies makes the
  // build non-reproducible. Scan both runtime and build deps; skip peer/optional.
  const seenUnpinned = new Set<string>();
  for (const [name, version] of [
    ...collectVersionEntries(pkg.dependencies),
    ...collectVersionEntries(pkg.devDependencies),
  ]) {
    if (seenUnpinned.has(name)) continue;
    if (isUnpinnedVersion(version)) {
      seenUnpinned.add(name);
      issues.push({
        kind: 'unpinned',
        package: name,
        severity: 'medium',
        detail: `'${name}' uses a floating version "${version}" — builds are not reproducible; pin an exact version or a ^/~ range`,
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

  // Version conflicts (high, GA-3): incompatible cross-section ranges + own-peer violations.
  issues.push(...detectVersionConflicts(packageJsonContent));

  return issues.slice(0, MAX_ISSUES);
}

/** True only for a REAL semver range. Non-semver specifiers (workspace: / file: / git / url / star /
 *  latest / x) can't be judged and are skipped so we never emit a false conflict. */
function isSemverRange(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  try { return validRange(t, { loose: true }) != null; } catch { return false; }
}

/** Do two real semver ranges have NO version in common? (Safe: unknown/erroring → treated as compatible.) */
function rangesIncompatible(a: string, b: string): boolean {
  if (!isSemverRange(a) || !isSemverRange(b)) return false;
  try { return !intersects(a, b, { loose: true }); } catch { return false; }
}

/**
 * GA-3 (Tier 2 dependency intelligence) — detect DECLARED version conflicts in a manifest that
 * `npm install` resolves silently-wrong (or that violate the project's own peer contract):
 *   • version-conflict (high): the SAME package pinned to NON-INTERSECTING ranges across the
 *     installed sections (dependencies / devDependencies / optionalDependencies). npm installs ONE
 *     version, so one section gets a version outside its range — the classic "types say v18 but the
 *     runtime resolved v17" break.
 *   • peer-violation (high): a dependencies/devDependencies version that does NOT satisfy the
 *     project's OWN declared peerDependencies range for that package.
 * Pure + semver-backed. Non-semver specifiers are skipped (never a false positive). Exported so the
 * exact conflict logic is unit-tested independently of the import scan.
 */
export function detectVersionConflicts(packageJsonContent: string | null): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJsonContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    pkg = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const deps = new Map(collectVersionEntries(pkg.dependencies));
  const dev = new Map(collectVersionEntries(pkg.devDependencies));
  const opt = new Map(collectVersionEntries(pkg.optionalDependencies));
  const peer = new Map(collectVersionEntries(pkg.peerDependencies));

  const issues: DependencyIssue[] = [];
  const flagged = new Set<string>(); // one issue per package — the highest-signal one

  // A) Incompatible ranges across the installed sections (npm resolves to a single version).
  const installed: Array<[string, Map<string, string>]> = [
    ['dependencies', deps], ['devDependencies', dev], ['optionalDependencies', opt],
  ];
  const names = new Set<string>([...deps.keys(), ...dev.keys(), ...opt.keys()]);
  for (const name of names) {
    const present = installed.filter(([, m]) => m.has(name)).map(([sec, m]) => [sec, m.get(name)!] as const);
    if (present.length < 2) continue;
    outer: for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        if (rangesIncompatible(present[i][1], present[j][1])) {
          flagged.add(name);
          issues.push({
            kind: 'version-conflict',
            package: name,
            severity: 'high',
            detail: `'${name}' is pinned to incompatible ranges: "${present[i][1]}" (${present[i][0]}) vs "${present[j][1]}" (${present[j][0]}) — npm installs ONE version, so one section resolves outside its range`,
          });
          break outer;
        }
      }
    }
  }

  // B) An installed version that violates the project's OWN peerDependencies requirement.
  for (const [name, peerRange] of peer) {
    if (flagged.has(name) || !isSemverRange(peerRange)) continue;
    const own = deps.get(name) ?? dev.get(name);
    if (!own || !isSemverRange(own)) continue;
    if (rangesIncompatible(own, peerRange)) {
      flagged.add(name);
      issues.push({
        kind: 'peer-violation',
        package: name,
        severity: 'high',
        detail: `'${name}' is installed as "${own}" but this project's peerDependencies require "${peerRange}" — the resolved version won't satisfy the peer contract`,
      });
    }
  }

  return issues;
}

/** A concise, honest dependency-consistency report for the agent (and the user). */
export function dependencySummary(issues: DependencyIssue[]): string {
  if (issues.length === 0) {
    return 'Dependency check: ✓ Dependencies consistent with package.json.';
  }
  const order: Record<DependencySeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<DependencySeverity, number>,
  );
  const head = `Dependency check: ${issues.length} issue(s) — ` +
    (['high', 'medium', 'low'] as DependencySeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const shown = sorted.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.kind}: ${x.package} — ${x.detail}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more].join('\n');
}
