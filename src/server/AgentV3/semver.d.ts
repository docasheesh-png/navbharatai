// Ambient types for the (installed) `semver` package, which ships no bundled types and for which
// @types/semver is intentionally NOT a dependency. Only the narrow surface DependencyAnalysis.ts
// uses (GA-3 version-conflict detection) is declared here — extend if a future caller needs more.
declare module 'semver' {
  /** Returns the normalized range, or null when `range` is not a valid semver range. */
  export function validRange(range: string, options?: { loose?: boolean }): string | null;
  /** True when the two semver ranges share at least one satisfying version. */
  export function intersects(r1: string, r2: string, options?: { loose?: boolean }): boolean;
}
