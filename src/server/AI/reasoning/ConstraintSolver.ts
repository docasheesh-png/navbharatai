// P-AI.14 — Constraint Solver (dependency version-constraint reasoning).
//
// An explicit, testable reasoning module that resolves conflicting DEPENDENCY VERSION constraints in a
// generated app's package.json — the near-term-valuable slice of P-AI.14. It catches version conflicts
// that break `npm install` or crash the app at runtime, from package.json alone (no network / registry):
//   • react ↔ react-dom major mismatch  — they MUST share a major or React throws at render (HIGH).
//   • the SAME package pinned to two different majors across dependencies/devDependencies (MEDIUM).
//   • @types/X major mismatch with X    — type/runtime drift (LOW).
//
// HONESTY / low false positives: only clear, single-major semver ranges are compared (^, ~, exact, x);
// complex or multi-major ranges (`>=16 <19`, `a || b`) are treated as "unknown" and never flagged. Pure
// and deterministic — no registry, no guessing.

export type ConflictKind = 'react-dom-mismatch' | 'duplicate-version-conflict' | 'types-mismatch';
export type ConflictSeverity = 'high' | 'medium' | 'low';

export interface DependencyConflict {
  kind: ConflictKind;
  severity: ConflictSeverity;
  package: string;
  file: string;
  detail: string;
}

export interface ConstraintReport {
  conflicts: DependencyConflict[];
  filesScanned: number;
  ok: boolean;
}

/**
 * The single dominant MAJOR version a range permits, or null when it is not a clear single-major range.
 * Handles `^18.2.0`, `~17.0`, `18.x`, `18.*`, `18`, `18.2.0`, `v18`, and `=18.0.0`. Anything with a
 * union/range operator (`||`, `-`, `>=…<`, `*`, `x` alone, `latest`, git/url) → null (unknown → skip).
 */
export function dominantMajor(range: unknown): number | null {
  if (typeof range !== 'string') return null;
  const r = range.trim();
  if (!r || r === '*' || r === 'x' || r === 'latest' || r.includes('||') || r.includes(' - ')) return null;
  // Reject explicit multi-bound ranges like ">=16 <19" (a space-separated comparator set).
  if (/\s/.test(r) && /[<>]/.test(r)) return null;
  // Non-registry specifiers (git, url, file, workspace) are unknowable here.
  if (/[:/]/.test(r) && !/^[v=^~]?\d/.test(r)) return null;
  const m = r.match(/^[v=^~>]*\s*(\d+)(?:\.(?:\d+|x|\*))?/i);
  if (!m) return null;
  const major = Number(m[1]);
  return Number.isFinite(major) ? major : null;
}

interface PkgJson { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; }

function parsePkg(content: string): PkgJson | null {
  try { const o = JSON.parse(content); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** Merge all dependency sections into one map (dependencies win over dev/peer for the "declared" range). */
function allDeps(pkg: PkgJson): Record<string, string> {
  return { ...(pkg.peerDependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
}

/** Analyze package.json files for dependency version conflicts. Pure + deterministic. */
export function analyzeDependencyConstraints(files: Record<string, string>): ConstraintReport {
  const conflicts: DependencyConflict[] = [];
  let scanned = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!/(^|\/)package\.json$/.test(path) || typeof content !== 'string') continue;
    const pkg = parsePkg(content);
    if (!pkg) continue;
    scanned++;
    const deps = allDeps(pkg);

    // 1) react ↔ react-dom major mismatch (hard runtime breaker).
    const reactMajor = dominantMajor(deps['react']);
    const reactDomMajor = dominantMajor(deps['react-dom']);
    if (reactMajor !== null && reactDomMajor !== null && reactMajor !== reactDomMajor) {
      conflicts.push({
        kind: 'react-dom-mismatch', severity: 'high', package: 'react-dom', file: path,
        detail: `react is v${reactMajor} but react-dom is v${reactDomMajor} — they must share a major version or React crashes at render. Align both to the same major.`,
      });
    }

    // 2) The same package pinned to two different majors across dependencies vs devDependencies.
    const inDeps = pkg.dependencies || {};
    const inDev = pkg.devDependencies || {};
    for (const name of Object.keys(inDeps)) {
      if (!(name in inDev)) continue;
      const a = dominantMajor(inDeps[name]);
      const b = dominantMajor(inDev[name]);
      if (a !== null && b !== null && a !== b) {
        conflicts.push({
          kind: 'duplicate-version-conflict', severity: 'medium', package: name, file: path,
          detail: `${name} is declared as v${a} in dependencies and v${b} in devDependencies — pick one major to avoid an ambiguous/duplicate install.`,
        });
      }
    }

    // 3) @types/X major mismatch with X (type/runtime drift).
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('@types/')) continue;
      const target = name.slice('@types/'.length).replace(/^/, ''); // e.g. @types/react → react
      const runtime = target === 'node' ? null : deps[target]; // @types/node has no runtime pkg
      if (runtime === undefined || runtime === null) continue;
      const tMajor = dominantMajor(deps[name]);
      const rMajor = dominantMajor(runtime);
      if (tMajor !== null && rMajor !== null && tMajor !== rMajor) {
        conflicts.push({
          kind: 'types-mismatch', severity: 'low', package: name, file: path,
          detail: `${name} is v${tMajor} but ${target} is v${rMajor} — the type definitions don't match the installed package version.`,
        });
      }
    }
  }

  return { conflicts, filesScanned: scanned, ok: conflicts.length === 0 };
}
