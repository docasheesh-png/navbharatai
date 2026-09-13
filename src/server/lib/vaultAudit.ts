/**
 * THE APP LOCK'S AUDIT TRAIL — "who opened this, and when?" must have an answer.
 *
 * Shared by the secrets routes (reveal, delete) and the lock routes (unlock, PIN set, areas changed),
 * because an audit split across two implementations is an audit with a gap in it.
 *
 * 🔒 WHAT IS NEVER WRITTEN HERE: a key's value, a PIN, a PIN hash, or a verification code. The log
 * records that an event happened and to whom — it is not a second copy of the thing being protected.
 */
import { collection, addDoc, getServerDb as getDb } from './serverDb';

/** Where reveals, deletions, unlocks and lock-setting changes are recorded. */
export const VAULT_AUDIT = 'secret_vault_audit';

/**
 * Record what happened, best-effort.
 *
 * Deliberately NOT awaited into the response and never allowed to fail the action: an audit write that
 * can break a delete would make the logging itself a denial-of-service on the user's own vault. A write
 * that fails is logged server-side, which is the honest outcome — we do not pretend it was recorded.
 *
 * ⚠️ The one thing that must NOT copy this pattern is the PIN's lock-out counter: that write IS the
 * security, so `savePinRecord` awaits it and fails the request if it cannot be stored. See the comment
 * there — a counter that can be dropped is not a counter.
 */
export function auditVault(userId: string, action: string, detail: Record<string, unknown>): void {
  const db = getDb() as any;
  if (!db) return;
  void (async () => {
    try {
      await addDoc(collection(db, VAULT_AUDIT), { user_id: userId, action, at: new Date(), ...detail });
    } catch (err) {
      console.error('[vault-audit] could not record', action, err instanceof Error ? err.message : err);
    }
  })();
}
