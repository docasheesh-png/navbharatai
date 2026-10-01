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
