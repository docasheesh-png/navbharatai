// Shared, AUTHENTICATED client for the /api/secrets vault endpoints.
//
// ROOT CAUSE this centralizes (admin 2026-07-21, "keys save hi nahi ho rahi"): the three
// /api/secrets routes require a valid Firebase ID token (requireUserMatch on POST/GET/DELETE), but
// the callers — SecretManager, DatabaseSettings, and the IDE AIChat "add key" box — each issued raw
// axios/fetch requests WITHOUT the Authorization header, so every save was rejected (401) and no key
// ever persisted. Three independent copies of the same call meant three chances to forget the token
// (and two already had). This module is the ONE place that talks to the vault: it always attaches the
// signed-in user's token, so a caller can never again forget it (rule 2 — fix the class, not the site).
//
// Pure of any component state; throws a real Error (with the server's message when present) so callers
// can surface an honest failure instead of a silent no-op.

// authHeaders moved to lib/authedFetch when a second caller needed it — one auth helper, no drift.
import { authHeaders } from './authedFetch';


export interface SecretMeta {
  id: string;
  secret_name: string;
  created_at?: unknown;
  deleted?: boolean;
}

/** Hard ceiling on any vault request so the caller's "Saving…" button can NEVER hang forever — if the
 *  server stalls, the request aborts and the caller surfaces an honest, recoverable error instead of a
 *  stuck spinner (admin symptom "button atak jata hai"). */
const REQUEST_TIMEOUT_MS = 20_000;

/** fetch with the auth header attached and a bounded timeout. Translates an abort into a clear message. */
async function vaultFetch(url: string, init: RequestInit, timeoutFallback: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, headers: { ...(init.headers || {}), ...(await authHeaders()) }, signal: controller.signal });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw new Error(timeoutFallback);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Read the caller's secret metadata (names only — never the encrypted value leaves the server). */
export async function listSecrets(userId: string): Promise<SecretMeta[]> {
  const res = await vaultFetch(`/api/secrets/${userId}`, {}, 'Loading your saved keys timed out. Please try again.');
  if (!res.ok) throw new Error(await errorMessage(res, 'Failed to load your saved keys'));
  return res.json();
}

/** Save (encrypt + store) one secret. Throws with the server's message on failure. */
export async function saveSecret(userId: string, secretName: string, secretValue: string): Promise<void> {
  const res = await vaultFetch(
    `/api/secrets/${userId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret_name: secretName, secret_value: secretValue }),
    },
    'Saving the key timed out. Please check your connection and try again.',
  );
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not save the key. Please try again.'));
}

/** Soft-delete one secret by id. Throws with the server's message on failure. */
export async function deleteSecret(userId: string, secretId: string): Promise<void> {
  const res = await vaultFetch(`/api/secrets/${userId}/${secretId}`, { method: 'DELETE' }, 'Deleting the key timed out. Please try again.');
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not delete the key. Please try again.'));
}

/** Prefer the server's honest `{ error }` message; on a 401 give a sign-in hint; else the fallback. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch { /* non-JSON body */ }
  if (res.status === 401) return 'Please sign in again to save your keys.';
  return fallback;
}
