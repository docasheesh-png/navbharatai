// The Cache Storage bucket `public/sw.js` uses for allowlisted read-only API GETs
// (`API_READ_CACHE`). One string, imported by every client that must drop it — never
// re-typed at a call site, or a sign-out will delete a name the worker no longer writes.
//
// The bucket is NOT keyed by uid. A prefix match used to store `/conversations/<id>`
// beside the list, and that response survived into the next account. v2 is the exact-path
// bucket; activate deletes v1 because this name is what KEEP keeps.

export const API_READ_CACHE = 'navbharat-api-v2';

/**
 * True when the account we already knew about is gone or replaced.
 * The first auth callback of a restored session has no previous uid, so a reload of the
 * SAME account keeps its offline copy. Sign-out (next uid null) and a switch both clear.
 */
export function shouldClearApiReadCache(previousUid: string | null, nextUid: string | null): boolean {
  return previousUid !== null && previousUid !== nextUid;
}
