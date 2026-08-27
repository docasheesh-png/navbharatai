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
import { validRange, intersects, minVersion, gt } from 'semver';

export type DependencySeverity = 'high' | 'medium' | 'low';

export interface DependencyIssue {
  kind: 'missing' | 'unused' | 'unpinned' | 'version-conflict' | 'peer-violation' | 'types-mismatch' | 'misplaced-dev-tool';
  package: string;
  severity: DependencySeverity;
  detail: string;
  /**
   * GA-3 resolver (version-conflict / peer-violation only): a concrete, deterministic
   * reconciliation the caller can apply — e.g. `Set devDependencies."react" to "^18.2.0"`.
   * Absent when no safe single-edit fix exists (the ranges must be reconciled by hand).
   */
  suggestion?: string;
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

  // Types/runtime major skew (medium, GA-3): `@types/x` on a different major than `x`.
  issues.push(...detectTypesMajorMismatch(packageJsonContent));

  // Unpinned git sources (medium, GA-3): a git dep with no #commit/#tag ref → non-reproducible.
  issues.push(...detectUnpinnedGitDeps(packageJsonContent));

  // Sibling major skew (high, GA-3): react/react-dom (etc.) on different majors → runtime break.
  issues.push(...detectSiblingMajorSkew(packageJsonContent));

  // Misplaced dev tools (low, GA-3): build-only/type-only packages in dependencies → prod bloat.
  issues.push(...detectMisplacedDevTools(packageJsonContent));

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

/** The lowest concrete version a range admits (e.g. "^18.2.0" → "18.2.0"), or null if unknowable. */
function rangeFloor(range: string): string | null {
  if (!isSemverRange(range)) return null;
  try { return minVersion(range, { loose: true })?.version ?? null; } catch { return null; }
}

/**
 * GA-3 resolver — for a version-conflict between two sections, recommend aligning the OLDER section
 * onto the NEWER range (the standard human fix: bump the lagging pin up to the current one). Returns
 * a concrete, single-edit instruction, or null when neither floor can be computed. `caretForm` keeps
 * the newer range's own spelling so we don't silently widen/narrow it (e.g. "^18.2.0" stays "^18.2.0").
 */
function suggestConflictFix(
  name: string,
  aSection: string, aRange: string,
  bSection: string, bRange: string,
): string | null {
  const aFloor = rangeFloor(aRange);
  const bFloor = rangeFloor(bRange);
  if (!aFloor || !bFloor) return null;
  // The "newer" side is the one whose lowest admissible version is higher.
  const aIsNewer = gt(aFloor, bFloor, { loose: true });
  const [newerSec, newerRange, olderSec] = aIsNewer
    ? [aSection, aRange, bSection]
    : [bSection, bRange, aSection];
  return `Set ${olderSec}."${name}" to "${newerRange}" to match ${newerSec} (align the older pin onto the newer range).`;
}

/**
 * GA-3 resolver — for a peer-violation, recommend bumping the installed dep to the peer range's
 * floor (the lowest version that satisfies the peer contract), spelled as a caret range so future
 * patch/minor updates stay allowed. Returns null when the peer floor can't be computed.
 */
function suggestPeerFix(name: string, section: string, peerRange: string): string | null {
  const floor = rangeFloor(peerRange);
  if (!floor) return null;
  return `Set ${section}."${name}" to "^${floor}" to satisfy the peerDependencies requirement "${peerRange}".`;
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
          const suggestion = suggestConflictFix(
            name, present[i][0], present[i][1], present[j][0], present[j][1],
          );
          issues.push({
            kind: 'version-conflict',
            package: name,
            severity: 'high',
            detail: `'${name}' is pinned to incompatible ranges: "${present[i][1]}" (${present[i][0]}) vs "${present[j][1]}" (${present[j][0]}) — npm installs ONE version, so one section resolves outside its range`,
            ...(suggestion ? { suggestion } : {}),
          });
          break outer;
        }
      }
    }
  }

  // B) An installed version that violates the project's OWN peerDependencies requirement.
  for (const [name, peerRange] of peer) {
    if (flagged.has(name) || !isSemverRange(peerRange)) continue;
    const ownSection = deps.has(name) ? 'dependencies' : 'devDependencies';
    const own = deps.get(name) ?? dev.get(name);
    if (!own || !isSemverRange(own)) continue;
    if (rangesIncompatible(own, peerRange)) {
      flagged.add(name);
      const suggestion = suggestPeerFix(name, ownSection, peerRange);
      issues.push({
        kind: 'peer-violation',
        package: name,
        severity: 'high',
        detail: `'${name}' is installed as "${own}" but this project's peerDependencies require "${peerRange}" — the resolved version won't satisfy the peer contract`,
        ...(suggestion ? { suggestion } : {}),
      });
    }
  }

  return issues;
}

/**
 * Map an `@types/*` package to the runtime package it types, or null if it isn't a types package.
 * Handles the double-underscore scoped convention: `@types/babel__core` → `@babel/core`.
 * `@types/node` maps to `node` (which is never a declared dependency, so it is naturally skipped).
 */
function typesToRuntime(name: string): string | null {
  if (!name.startsWith('@types/')) return null;
  const sub = name.slice('@types/'.length);
  if (!sub) return null;
  if (sub.includes('__')) {
    const [scope, pkg] = sub.split('__');
    if (!scope || !pkg) return null;
    return `@${scope}/${pkg}`;
  }
  return sub;
}

/** The major-version number a range's lowest admissible version carries (e.g. "^18.2.0" → 18), or null. */
function rangeMajor(range: string): number | null {
  const floor = rangeFloor(range);
  if (!floor) return null;
  const major = Number.parseInt(floor.split('.')[0], 10);
  return Number.isNaN(major) ? null : major;
}

/**
 * GA-3 (Tier-2 dependency intelligence) — detect a runtime package and its `@types/*` package pinned to
 * DIFFERENT majors (e.g. `react: "^18"` with `@types/react: "^17"`). The typings then describe a
 * different major than the installed library — the classic silent typecheck break where the API in the
 * editor doesn't match the API at runtime. Uses non-intersecting ranges as the signal (so a `@types`
 * minor that legitimately trails the lib is never flagged), and only when both are real semver ranges.
 * Medium severity: it breaks typechecking / DX, not the install. Pure + semver-backed. Exported for tests.
 */
export function detectTypesMajorMismatch(packageJsonContent: string | null): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJsonContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    pkg = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  // Runtime version for a package name from either dependencies or devDependencies (deps wins).
  const deps = new Map(collectVersionEntries(pkg.dependencies));
  const dev = new Map(collectVersionEntries(pkg.devDependencies));
  const typesEntries = [
    ...collectVersionEntries(pkg.dependencies),
    ...collectVersionEntries(pkg.devDependencies),
  ].filter(([name]) => name.startsWith('@types/'));

  const issues: DependencyIssue[] = [];
  const seen = new Set<string>();
  for (const [typesName, typesRange] of typesEntries) {
    if (seen.has(typesName)) continue;
    const runtimeName = typesToRuntime(typesName);
    if (!runtimeName) continue;
    const runtimeRange = deps.get(runtimeName) ?? dev.get(runtimeName);
    if (!runtimeRange) continue; // no runtime package to compare against (e.g. @types/node)
    if (!isSemverRange(typesRange) || !isSemverRange(runtimeRange)) continue;
    // Non-intersecting ranges ⇒ the types major cannot line up with the runtime major.
    if (!rangesIncompatible(runtimeRange, typesRange)) continue;
    seen.add(typesName);
    const rtMajor = rangeMajor(runtimeRange);
    const suggestion = rtMajor != null
      ? `Set "${typesName}" to "^${rtMajor}" to match ${runtimeName} (${runtimeRange}).`
      : undefined;
    issues.push({
      kind: 'types-mismatch',
      package: typesName,
      severity: 'medium',
      detail: `'${typesName}' ("${typesRange}") types a DIFFERENT major than the installed '${runtimeName}' ("${runtimeRange}") — the editor's API won't match runtime and typechecking will drift`,
      ...(suggestion ? { suggestion } : {}),
    });
  }
  return issues;
}

/**
 * Sibling packages that MUST share the same major version or they break at runtime — different-major
 * combinations that `npm install` happily installs but that crash the app (react/react-dom is the
 * canonical case: a v18 react with a v17 react-dom throws on render). Curated + conservative: only
 * pairs with a hard same-major contract belong here, so we never false-positive on independent libs.
 */
const SIBLING_MAJOR_GROUPS: string[][] = [
  ['react', 'react-dom'],
  ['@angular/core', '@angular/common', '@angular/compiler', '@angular/platform-browser', '@angular/platform-browser-dynamic'],
];

/**
 * GA-3 (Tier-2 dependency intelligence) — detect SIBLING packages pinned to different majors when they
 * must share one (e.g. `react: "^18"` with `react-dom: "^17"`). Unlike `detectVersionConflicts` (the
 * SAME package across sections), this catches DIFFERENT package names bound by a hard same-major
 * contract — a very common, hard runtime break. Uses non-intersecting ranges as the signal and only
 * real semver ranges; suggests aligning the older sibling onto the newer major. Pure. Exported for tests.
 */
export function detectSiblingMajorSkew(packageJsonContent: string | null): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJsonContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    pkg = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const declared = new Map<string, string>([
    ...collectVersionEntries(pkg.dependencies),
    ...collectVersionEntries(pkg.devDependencies),
  ]);

  const issues: DependencyIssue[] = [];
  const flagged = new Set<string>(); // one issue per group
  for (const group of SIBLING_MAJOR_GROUPS) {
    const members = group
      .map((name) => [name, declared.get(name)] as const)
      .filter((e): e is readonly [string, string] => !!e[1] && isSemverRange(e[1]));
    if (members.length < 2) continue;
    // Find the newest member (highest major floor) and any member on a different, non-intersecting major.
    const newest = members.reduce((a, b) => ((rangeMajor(b[1]) ?? 0) > (rangeMajor(a[1]) ?? 0) ? b : a));
    const newestMajor = rangeMajor(newest[1]);
    for (const [name, range] of members) {
      if (name === newest[0] || flagged.has(group[0])) continue;
      if (rangesIncompatible(range, newest[1])) {
        flagged.add(group[0]);
        const suggestion = newestMajor != null
          ? `Set "${name}" to "^${newestMajor}" to match ${newest[0]} (${newest[1]}) — they must share a major.`
          : undefined;
        issues.push({
          kind: 'version-conflict',
          package: name,
          severity: 'high',
          detail: `'${name}' ("${range}") and '${newest[0]}' ("${newest[1]}") are pinned to DIFFERENT majors but must share one — the app breaks at runtime`,
          ...(suggestion ? { suggestion } : {}),
        });
        break;
      }
    }
  }
  return issues;
}

/**
 * Explicit git dependency specifiers (npm's git forms + host shortcuts). A bare `user/repo` shorthand
 * is intentionally excluded — it's ambiguous with a scopeless package name, so flagging it would
 * false-positive. Matched case-insensitively against the trimmed version string.
 */
function isGitSpec(version: string): boolean {
  const t = version.trim().toLowerCase();
  return (
    t.startsWith('github:') || t.startsWith('gitlab:') || t.startsWith('bitbucket:') ||
    t.startsWith('gist:') || t.startsWith('git://') || t.startsWith('git+')
  );
}

/**
 * GA-3 (Tier-2 dependency intelligence) — flag a git dependency with NO pinned ref (e.g.
 * `"dep": "github:user/repo"` or `"git+https://…/repo.git"`). Without a `#<commit|tag>` fragment npm
 * resolves it to the repository's DEFAULT BRANCH HEAD, which moves over time — the same "worked
 * yesterday, broke on reinstall" non-reproducibility the `unpinned` check guards for `*`/`latest`, but
 * for git sources (which that check deliberately skips). Conservative: only explicit git forms without
 * a `#` fragment are flagged; a `#commit`/`#tag`/`#semver:` ref is treated as pinned. Pure. Exported
 * for tests. Reuses the `unpinned` kind (same non-reproducibility class), medium severity.
 */
export function detectUnpinnedGitDeps(packageJsonContent: string | null): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJsonContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    pkg = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const issues: DependencyIssue[] = [];
  const seen = new Set<string>();
  for (const [name, version] of [
    ...collectVersionEntries(pkg.dependencies),
    ...collectVersionEntries(pkg.devDependencies),
  ]) {
    if (seen.has(name) || !isGitSpec(version) || version.includes('#')) continue;
    seen.add(name);
    issues.push({
      kind: 'unpinned',
      package: name,
      severity: 'medium',
      detail: `'${name}' points at a git source "${version}" with no ref — it resolves to the default branch HEAD and changes over time; installs are not reproducible`,
      suggestion: `Append a "#<commit-sha-or-tag>" to "${version}" so the install is reproducible.`,
    });
  }
  return issues;
}

/**
 * Unambiguous BUILD-ONLY / dev-time packages that never belong in `dependencies` (they bloat the
 * production install and ship dev tooling to end users). Curated + conservative — only packages with
 * no legitimate runtime import — plus every `@types/*` (type-only, stripped at build). This is distinct
 * from the `unused` check, which deliberately SKIPS these implicit-toolchain names entirely.
 */
export const DEV_ONLY_TOOLS = new Set<string>([
  'vite', 'eslint', 'prettier', 'typescript', 'webpack', 'webpack-cli', 'rollup', 'esbuild', 'parcel',
  'vitest', 'jest', 'mocha', 'karma', '@playwright/test', 'cypress', 'ts-node', 'tsx', 'nodemon',
  'rimraf', 'cross-env', 'concurrently', 'npm-run-all', '@biomejs/biome', 'tailwindcss', 'postcss',
  'autoprefixer', 'storybook', 'turbo',
]);

/**
 * Is this package a build-only tool that belongs in `devDependencies`?
 *
 * EXPORTED so the two halves of this idea can never drift apart again (autopsy 2026-08-27). The
 * knowledge lived only HERE, in the module that REPORTS the defect, while `applyWellKnownMissingDeps`
 * in DependencyAutoFix.ts — the module that WRITES dependencies — had never heard of it and put
 * everything into `dependencies`. So NavBharatAI added `tailwindcss` to a user's `dependencies` and
 * then, in the same build, flagged it: "'tailwindcss' is a build-only tool declared in dependencies —
 * move it to devDependencies." We manufactured the finding we reported, and handed the user the
 * cleanup. Proven end-to-end before the fix, in three steps, against real code.
 *
 * One predicate, two callers: the writer places, the analyzer judges, and both consult this. PURE.
 */
export function isDevOnlyTool(name: string): boolean {
  const n = String(name ?? '').trim();
  if (!n) return false;
  return DEV_ONLY_TOOLS.has(n) || n.startsWith('@types/');
}

/**
 * GA-3 (Tier-2 dependency intelligence) — flag a build-only tool declared in `dependencies` instead of
 * `devDependencies`. It ships dev tooling into the production install (bigger, slower, larger attack
 * surface) with no runtime benefit. Low severity (best-practice, not a break). Conservative: only the
 * curated DEV_ONLY_TOOLS set + every `@types/*` are flagged, so a real runtime library is never
 * mislabelled. Pure. Exported for tests.
 */
export function detectMisplacedDevTools(packageJsonContent: string | null): DependencyIssue[] {
  if (packageJsonContent == null) return [];
  let pkg: Record<string, unknown>;
  try {
    const parsed = JSON.parse(packageJsonContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    pkg = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const issues: DependencyIssue[] = [];
  for (const name of collectNames(pkg.dependencies)) {
    if (!DEV_ONLY_TOOLS.has(name) && !name.startsWith('@types/')) continue;
    const kindLabel = name.startsWith('@types/') ? 'type-only package' : 'build-only tool';
    issues.push({
      kind: 'misplaced-dev-tool',
      package: name,
      severity: 'low',
      detail: `'${name}' is a ${kindLabel} declared in dependencies — it ships to the production install with no runtime benefit`,
      suggestion: `Move "${name}" from dependencies to devDependencies.`,
    });
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
  const body = shown.map((x) =>
    `  - [${x.severity}] ${x.kind}: ${x.package} — ${x.detail}` +
    (x.suggestion ? `\n      ↳ Fix: ${x.suggestion}` : ''),
  );
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more].join('\n');
}
