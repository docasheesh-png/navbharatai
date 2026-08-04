// Centralized, tested sign-out teardown — ROOT-CAUSE FIX (admin 2026-07-11:
// "desktop: recent logout ke baad wapas login hota hi nahi").
//
// BUG CLASS THIS KILLS: three drifted copies of the logout handler (App.tsx
// ProfilePage, Header.tsx, TopNav.tsx) each did, verbatim:
//     indexedDB.deleteDatabase('firebaseLocalStorageDb');  // fire-and-forget
//     window.location.reload();                            // fires immediately
// i.e. they deleted Firebase's OWN IndexedDB out from under the live SDK and
// reloaded mid-delete. `deleteDatabase` is async and, while the SDK still holds
// the connection open, fires `onblocked` and DEFERS the deletion. The immediate
// reload then races that pending delete: on the NEXT load Firebase's persistence
// layer re-opens `firebaseLocalStorageDb` while the old delete is still resolving,
// leaving persistence in a broken state — so a subsequent Google sign-in completes
// at Google but can never be written back, `onAuthStateChanged` never delivers the
// user, and the UI stays logged out. It bit ONLY the logout→login path (a fresh
// visit never deletes the DB), which is exactly the reported desktop symptom.
//
// THE FIX (root cause, not symptom):
//  1. `await signOut()` behind a bounded timeout, and TRACK whether it completed.
//     A clean signOut already removes Firebase's persisted current-user, so a
//     reload comes back signed-out with NO manual DB deletion needed.
//  2. Delete the IndexedDB ONLY in the hang case (signOut timed out / threw) —
//     the one scenario the manual delete was ever added for — and AWAIT it (with
//     its own bounded, blocked-safe wait) so no pending delete survives the reload.
//  3. Reload LAST, after teardown has settled.
// Net: the common logout→login path never deletes the DB → next login's persistence
// is intact → login works the first time. Pure over injected deps → fully testable.

export interface SignOutFlowDeps {
  /** firebase signOut(auth). */
  signOut: () => Promise<void>;
  /** Clear our own persisted session mirrors (stale firebase authUser keys + admin session). */
  clearStorage: () => void;
  /** Await-able, blocked-safe delete of Firebase's auth IndexedDB. Only invoked on the hang path. */
  deleteAuthDb: () => Promise<void>;
  /** window.location.reload — invoked last. */
  reload: () => void;
  /** Optional site-specific extra cleanup (e.g. clearing the per-user GitHub connection). */
  extraCleanup?: () => void;
  /** Injectable for tests. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  /** How long to wait for signOut before falling back to the forced teardown. */
  signOutTimeoutMs?: number;
}

/**
 * Sign the user out so that the NEXT login works the first time. Returns whether the
 * forced IndexedDB deletion had to run (true only when signOut hung/failed) — exposed
 * for tests and telemetry, never for control flow.
 */
export async function performSignOut(deps: SignOutFlowDeps): Promise<{ deletedDb: boolean }> {
  const timeoutMs = deps.signOutTimeoutMs ?? 2500;
  const schedule = deps.setTimeoutFn ?? setTimeout;

  // 1. signOut, but never hang the UI: race a bounded timeout and record if it truly completed.
  const signedOut = await Promise.race<boolean>([
    deps.signOut().then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => schedule(() => resolve(false), timeoutMs)),
  ]);

  // 2. Always clear our own keys (admin session + any stale firebase authUser mirrors).
  try { deps.clearStorage(); } catch { /* best effort — reload still signs out */ }
  try { deps.extraCleanup?.(); } catch { /* best effort */ }

  // 3. Only NUKE Firebase's IndexedDB when signOut did NOT complete. On a clean signOut the
  //    user is already gone from persistence, so deleting the DB is unnecessary AND is exactly
  //    what corrupted the next login. When we must delete, AWAIT it so no pending delete races
  //    the reload.
  let deletedDb = false;
  if (!signedOut) {
    try { await deps.deleteAuthDb(); deletedDb = true; } catch { /* best effort */ }
  }

  // 4. Reload only after teardown has settled.
  deps.reload();
  return { deletedDb };
}

/**
 * Await-able, blocked-safe delete of an IndexedDB database. Resolves on success, error, OR
 * `onblocked` (a still-open connection blocks the delete — we must not hang the logout on it),
 * and hard-caps on a timeout so a browser that fires no event at all can never wedge sign-out.
 * Injectable `idb`/`setTimeoutFn` for tests; swallows a throwing `indexedDB` entirely.
 */
export function deleteFirebaseAuthDb(
  dbName = 'firebaseLocalStorageDb',
  opts: {
    idb?: { deleteDatabase(name: string): IDBOpenDBRequest };
    maxWaitMs?: number;
    setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  } = {},
): Promise<void> {
  const idb = opts.idb ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  const maxWaitMs = opts.maxWaitMs ?? 1500;
  const schedule = opts.setTimeoutFn ?? setTimeout;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    if (!idb) { finish(); return; }
    try {
      const req = idb.deleteDatabase(dbName);
      req.onsuccess = finish;
      req.onerror = finish;
      // A live SDK connection blocks the delete; resolving here keeps logout responsive.
      (req as unknown as { onblocked: (() => void) | null }).onblocked = finish;
      schedule(finish, maxWaitMs);
    } catch {
      finish();
    }
  });
}

/** Regex for the Firebase-persisted current-user mirror sometimes kept in localStorage. */
const FIREBASE_AUTH_KEY = /^firebase:authUser/i;
const FIREBASE_LOCAL_STORE_KEY = /firebaseLocalStorage/i;

/**
 * The common storage teardown every logout site shares: drop stale Firebase authUser mirrors
 * from localStorage plus the admin session (localStorage flag + sessionStorage token). Kept in
 * ONE place so the three logout sites can never drift again. Best-effort throughout.
 */
export function defaultClearAuthStorage(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (FIREBASE_AUTH_KEY.test(k) || FIREBASE_LOCAL_STORE_KEY.test(k)) localStorage.removeItem(k);
    }
  } catch { /* storage may be unavailable — reload still signs out */ }
  try {
    localStorage.removeItem('navbharat_admin_v1');
    localStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_token'); // stale key from before the localStorage migration
  } catch { /* storage may be unavailable */ }
}
