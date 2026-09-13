/**
 * THE TWO CALLS THAT SPEND AN APP-LOCK TICKET — reading a saved key, and destroying one.
 *
 * The lock itself (the PIN, the code, the shared unlock, which areas are guarded) lives in `appLock.ts`.
 * What is left here is the pair of requests that are only ever allowed WITH a ticket, kept beside the
 * secrets screen they belong to rather than inside the lock.
 *
 * 🔒 THIS IS WHERE THE APP LOCK STOPS BEING A SCREEN LOCK. On every other guarded screen the data behind
 * the PIN is the user's own and their session already reaches it, so the lock hides a view. Here the
 * SERVER refuses to decrypt or delete without a ticket minted seconds ago — so deleting every line of the
 * unlock UI would make these keys unreadable rather than public, which is the test of whether a lock is
 * real.
 */
import { authHeaders } from './authedFetch';
import { UNLOCK_TICKET_HEADER, type VaultError } from './appLock';

export { UNLOCK_TICKET_HEADER };

export interface RevealedSecret {
  id: string;
  secret_name: string;
  secret_value: string;
  /** False when the stored value could not be decrypted — shown as such, never as an empty key. */
  readable: boolean;
  workspace_id?: string | null;
  created_at?: unknown;
}

async function ticketed<T>(url: string, init: RequestInit, ticket: string, fallback: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), [UNLOCK_TICKET_HEADER]: ticket, ...(await authHeaders()) },
  });
  if (!res.ok) {
    let message = fallback;
    let needsUnlock = res.status === 401;
    try {
      const parsed = await res.json();
      if (parsed?.error) message = String(parsed.error);
      if (typeof parsed?.needsUnlock === 'boolean') needsUnlock = parsed.needsUnlock;
    } catch { /* non-JSON body */ }
    const err = new Error(message) as VaultError;
    err.status = res.status;
    // The screen re-locks on this rather than showing a stale error on a dead panel.
    err.needsUnlock = needsUnlock;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Read the real values. Requires a live ticket; the server refuses otherwise. */
export function revealSecrets(userId: string, ticket: string): Promise<RevealedSecret[]> {
  return ticketed<RevealedSecret[]>(
    `/api/secrets/${userId}/reveal`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    ticket,
    'Could not read your keys.',
  );
}

/** Delete one key for good. Requires a live ticket — deleting is destructive, so it needs the same proof. */
export async function deleteSecretLocked(userId: string, secretId: string, ticket: string): Promise<void> {
  await ticketed<unknown>(`/api/secrets/${userId}/${secretId}`, { method: 'DELETE' }, ticket, 'Could not delete the key.');
}
