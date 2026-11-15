/** Server-derived lifecycle evidence only. Manual-edit ownership is not project existence. */
export interface RoyaleProjectEvidence {
  inventoryRead: boolean;
  hasVerifiedRevision: boolean;
  hydratedSourceIsNew: boolean;
  intent: string;
  editing: boolean;
  importing: boolean;
  importRequested: boolean;
  durablePathCount: number;
  durableSourceCount: number;
  verifiedStarterSourceCount: number;
}
export function royaleNewProjectAllowed(e: RoyaleProjectEvidence): boolean {
  return e.inventoryRead === true && e.hasVerifiedRevision === false && e.hydratedSourceIsNew === true && e.intent === 'new_build' && e.editing === false
    && e.importing === false && e.importRequested === false && e.durableSourceCount === 0
    && (e.durablePathCount === 0 || e.verifiedStarterSourceCount > 0);
}
