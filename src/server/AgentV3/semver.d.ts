// Ambient types for the (installed) `semver` package, which ships no bundled types and for which
// @types/semver is intentionally NOT a dependency. Only the narrow surface DependencyAnalysis.ts
// uses (GA-3 version-conflict detection) is declared here — extend if a future caller needs more.
declare module 'semver' {
  /** Returns the normalized range, or null when `range` is not a valid semver range. */
  export function validRange(range: string, options?: { loose?: boolean }): string | null;
  /** True when the two semver ranges share at least one satisfying version. */
  export function intersects(r1: string, r2: string, options?: { loose?: boolean }): boolean;
  /** The lowest version that satisfies `range` (as a SemVer object), or null if none/invalid. */
  export function minVersion(range: string, options?: { loose?: boolean }): { version: string } | null;
  /** True when version `a` is strictly greater than version `b` (SemVer precedence). */
  export function gt(a: string, b: string, options?: { loose?: boolean }): boolean;
  /** The normalized version, or null when `version` is not valid semver (peerCompatHint.ts). */
  export function valid(version: string, options?: { loose?: boolean }): string | null;
  /** True when `version` satisfies `range`. */
  export function satisfies(version: string, range: string, options?: { loose?: boolean; includePrerelease?: boolean }): boolean;
  /** The prerelease parts of `version` ("rc", 1), or null for a stable release. */
  export function prerelease(version: string, options?: { loose?: boolean }): ReadonlyArray<string | number> | null;
  /** Descending comparator, for `sort`. */
  export function rcompare(a: string, b: string, options?: { loose?: boolean }): number;
}
