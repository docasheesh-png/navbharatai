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
  /**
   * The app this key belongs to, or null for a key shared with every app.
   *
   * Metadata, never a credential. Null is what every key saved before app-scoping existed carries, and
   * what "All apps" still means — see server/lib/secretScope.ts for why that default is load-bearing.
   */
  workspace_id?: string | null;
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

/**
 * Save (encrypt + store) one secret. Throws with the server's message on failure.
 *
 * `workspaceId` ties the key to ONE app, so the user's other apps never receive it. Omit it for a key
 * shared with every app — which is what every key saved before app-scoping existed is, and what the
 * Settings screen offers as an explicit choice.
 */
export async function saveSecret(
  userId: string,
  secretName: string,
  secretValue: string,
  workspaceId?: string | null,
): Promise<void> {
  const res = await vaultFetch(
    `/api/secrets/${userId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret_name: secretName,
        secret_value: secretValue,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      }),
    },
    'Saving the key timed out. Please check your connection and try again.',
  );
  if (!res.ok) throw new Error(await errorMessage(res, 'Could not save the key. Please try again.'));
}

/** What the provider itself said about a saved credential. Mirrors the server's ProbeVerdict, minus
 *  `detail` (HTTP statuses and error types are diagnostics and stay server-side). */
export interface SecretVerdict {
  /** The variable name(s) this covers, exactly as the user saved them. Never a value. */
  names: string[];
  /** The provider as the user knows it — "Stripe". */
  provider: string;
  /** 'working' is the only status that means proven; 'unreachable'/'not-testable' mean we could not tell. */
  status: 'working' | 'rejected' | 'unreachable' | 'not-testable';
  message: string;
}

/**
 * Ask the server to check the caller's SAVED keys against the providers themselves.
 *
 * Call this AFTER `saveSecret`, not instead of it: the plaintext is deliberately not sent here — the
 * server reads the values back out of the user's own encrypted vault, so verifying adds no second path
 * for a live credential to travel over the network.
 *
 * Returns [] rather than throwing when the check itself fails. A verification we could not run is not a
 * verdict on the user's keys, and it must never turn a successful SAVE into a visible error.
 */
export async function verifySecrets(userId: string): Promise<SecretVerdict[]> {
  try {
    const res = await vaultFetch(
      `/api/secrets/${userId}/verify`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      'Checking your keys timed out.',
    );
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.verdicts) ? body.verdicts : [];
  } catch {
    return [];
  }
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
