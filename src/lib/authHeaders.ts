// Shared client auth headers — one place that attaches the verified Firebase ID token so the
// server can resolve a REAL identity (SECURITY Phase 1). Extracted so every money/secret-bearing
// fetch (v5.0 build, Engineer AI, …) sends the token the same way instead of each re-implementing
// it (and some, like Engineer AI, forgetting it — which left the server unable to verify the caller
// and forced it onto the spoofable body userId).
// 🔒 IMPORTS FROM `./firebase`, NEVER FROM `../App` (fixed 2026-08-24). This single line used to
// read `import { auth } from '../App'`, and it was the root cause of the app's whole first-paint
// weight: `authedFetch` uses this module, nearly every feature uses `authedFetch`, and `App.tsx`
// statically imports ~84 modules — so every feature transitively pulled the entire app graph in and
// the bundler could not split ANY of it. `App.tsx` never created `auth`; it only re-exported it from
// here, so this was always the correct source. See tests/appModuleGraph.test.ts.
import { auth } from './firebase';

/**
 * JSON headers plus `Authorization: Bearer <idToken>` when a user is signed in. Never throws — a
 * token fetch failure just omits the header, and the server degrades to an anonymous (non-billed,
 * non-secret) path rather than hard-blocking. `forceRefresh` re-mints a possibly-stale token.
 */
export async function authJsonHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = await auth.currentUser?.getIdToken(forceRefresh);
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* no token — server degrades to an anonymous path (never hard-blocks) */ }
  return headers;
}

/**
 * Just the Authorization header — no content type — for GET callers and for `authedFetch`, which
 * merges it into a caller-supplied `headers`.
 *
 * Added by audit finding #3b: the repo already had TWO shared token helpers (this module and
 * `authedFetch.authHeaders`) and EIGHT private copies grew anyway, under four different names. The
 * copies were not written out of ignorance — the bare-header shape simply did not exist here, so each
 * caller that did not want `Content-Type` wrote the whole helper again. One shape per real need is
 * what actually stops the next copy.
 */
export async function authHeader(forceRefresh = false): Promise<Record<string, string>> {
  try {
    const tok = await auth.currentUser?.getIdToken(forceRefresh);
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch {
    return {}; // signed out / Firebase not ready — the server answers 401, which the caller surfaces
  }
}

/**
 * Caller-supplied headers plus `Authorization: Bearer <idToken>`.
 *
 * The third shape in this module, and it earns its place: `authJsonHeaders` forces
 * `Content-Type: application/json`, `authHeader` returns the bare token header, and this one MERGES
 * the token into headers the caller already has. Moved here from `App.tsx` (2026-08-24) — see the
 * note on the import above for why nothing may live in the root component just because it is
 * convenient there.
 *
 * SECURITY: the wallet/sync routes verify this token server-side (`requireUserMatch`) instead of
 * trusting the `:userId` in the path, so these calls MUST send it. Best-effort by design: a missing
 * token just omits the header and the server answers 401, which the callers handle gracefully.
 */
export async function authedHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(extra || {}) };
  try {
    const tok = await auth.currentUser?.getIdToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
  } catch { /* token unavailable — header omitted */ }
  return headers;
}
