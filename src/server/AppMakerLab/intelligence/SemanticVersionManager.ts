/**
 * P-PME.13 — Semantic Version Manager.
 *
 * Snapshots had names but no semantic version, so users couldn't tell a breaking change from a fix.
 * This computes a major.minor.patch bump from a build's structural diff:
 *   - MAJOR: the app's page or entity count changed (structural / potentially breaking).
 *   - MINOR: new features added (more components/routes) with no structural change.
 *   - PATCH: a repair/fix with no structural or feature change.
 * Pure + dependency-free + unit-tested. A route exposes it; persistence is the caller's concern.
 */

export type BumpKind = 'major' | 'minor' | 'patch';

export interface SemVer { major: number; minor: number; patch: number }

/** Parse "x.y.z" (lenient — missing/garbage parts become 0). */
export function parseSemver(v: string | null | undefined): SemVer {
  const m = String(v || '').trim().replace(/^v/i, '').split('.');
  const n = (x: string | undefined) => {
    const p = parseInt(x ?? '', 10);
    return Number.isFinite(p) && p >= 0 ? p : 0;
  };
  return { major: n(m[0]), minor: n(m[1]), patch: n(m[2]) };
}

export function formatSemver(s: SemVer): string {
  return `${s.major}.${s.minor}.${s.patch}`;
}

/** Apply a bump to a version. major resets minor+patch; minor resets patch. Pure. */
export function bumpVersion(current: string, kind: BumpKind): string {
  const v = parseSemver(current);
  if (kind === 'major') return formatSemver({ major: v.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') return formatSemver({ major: v.major, minor: v.minor + 1, patch: 0 });
  return formatSemver({ major: v.major, minor: v.minor, patch: v.patch + 1 });
}

export interface BlueprintSignals {
  /** Number of pages/screens. */
  pages: number;
  /** Number of data entities/models. */
  entities: number;
  /** Number of features/components (used for MINOR detection). */
  features?: number;
}

/**
 * Classify the bump between two builds. `repairOnly` forces PATCH. Otherwise: a change in page or
 * entity count → MAJOR; an increase in features → MINOR; anything else → PATCH. Pure.
 */
export function classifyBump(prev: BlueprintSignals, next: BlueprintSignals, opts: { repairOnly?: boolean } = {}): BumpKind {
  if (opts.repairOnly) return 'patch';
  if (next.pages !== prev.pages || next.entities !== prev.entities) return 'major';
  if ((next.features ?? 0) > (prev.features ?? 0)) return 'minor';
  return 'patch';
}

export interface VersionResult { previous: string; next: string; bump: BumpKind }

/** Compute the next version from the current version + the structural diff. Pure. */
export function computeNextVersion(current: string, prev: BlueprintSignals, next: BlueprintSignals, opts: { repairOnly?: boolean } = {}): VersionResult {
  const bump = classifyBump(prev, next, opts);
  const previous = formatSemver(parseSemver(current || '0.0.0'));
  return { previous, next: bumpVersion(previous, bump), bump };
}
