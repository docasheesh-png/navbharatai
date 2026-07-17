// Shared client auth headers — one place that attaches the verified Firebase ID token so the
// server can resolve a REAL identity (SECURITY Phase 1). Extracted so every money/secret-bearing
// fetch (v5.0 build, Engineer AI, …) sends the token the same way instead of each re-implementing
// it (and some, like Engineer AI, forgetting it — which left the server unable to verify the caller
// and forced it onto the spoofable body userId).
import { auth } from '../App';

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
