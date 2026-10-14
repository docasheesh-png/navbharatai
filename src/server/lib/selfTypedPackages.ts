/**
 * Packages that ship their OWN TypeScript types from the given major on, so a `@types/*` copy beside them
 * is never needed — each one's `@types` package is a deprecated stub, or stops at an older major
 * (`@types/react-router-dom` ends at 5). Read by both dependency checks (DependencyAnalysis and the
 * ConstraintSolver), so neither can advise "match the major" for a types package that has no such major
 * (autopsy a106df77). Conservative: only packages whose own types are certain belong here. PURE.
 */
export const SHIPS_OWN_TYPES: Readonly<Record<string, number>> = {
  'react-router-dom': 6,
  'react-router': 6,
  axios: 0,
  zustand: 0,
  'date-fns': 2,
  dayjs: 0,
  'framer-motion': 0,
  'lucide-react': 0,
};

/** True when `runtime` at `major` ships its own types, so `@types/<runtime>` is redundant. */
export function shipsOwnTypes(runtime: string, major: number | null): boolean {
  const from = SHIPS_OWN_TYPES[runtime];
  return from !== undefined && major !== null && major >= from;
}

/**
 * Packages whose `@types/*` major is NOT kept in step with the runtime's (autopsy 398db9f3, Q-1066).
 *
 * The finding "@types/better-sqlite3 is v9 but better-sqlite3 is v13" advised matching a major that
 * DefinitelyTyped does not publish — the same false advice a106df77 ended for packages that ship their
 * own types. For these, a lower typings major is the normal state of the registry, so a mismatch says
 * nothing about the app and must not be raised. Conservative: only packages known to lag belong here;
 * the pure analyzers have no registry access, so this list is the evidence. PURE.
 */
export const TYPINGS_LAG_RUNTIME: ReadonlySet<string> = new Set(['better-sqlite3']);

/** True when a typings-vs-runtime major difference for `runtime` is expected and not a finding. */
export function typingsMajorMayLag(runtime: string): boolean {
  return TYPINGS_LAG_RUNTIME.has(runtime);
}
