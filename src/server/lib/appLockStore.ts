/**
 * READING AND WRITING ONE USER'S APP-LOCK RECORD — the single Firestore door.
 *
 * Extracted from `routes/appLock.ts` the moment a SECOND caller needed it: the money routes now ask
 * "is this area locked?" before spending anything. Two copies of this read would be two places for the
 * collection name, the coercion and the failure behaviour to drift — and the failure behaviour here is
 * security-relevant, so that drift would be the dangerous kind.
 */
import { doc, getDoc, runTransaction, getServerDb as getDb } from './serverDb';
import { readPinRecord, writePinRecord, emptyPinRecord, type VaultPinRecord } from './vaultPin';

/** Where each user's PIN hash, lock-out state, pending code and locked-area list live. One doc per user. */
export const VAULT_PIN_COLLECTION = 'user_vault_pin';

/**
 * Load one user's lock record; only an acknowledged missing document gives an empty one.
 *
 * A MISSING document is the default state (no PIN, only the mandatory area locked) — that is what every
 * account that has never opened this feature looks like, so it must be the quiet, ordinary answer.
 *
 * ⚠️ A THROW IS NOT THE SAME THING AND IS NOT CAUGHT HERE. Whether an unreadable record should open or
 * close a given door depends on what that door does — a screen, or somebody's money — so the decision
 * belongs to the caller and is made explicitly at each one (see `appLockEnforce.ts`). Swallowing the
 * error here would take that choice away and hand every caller the most permissive answer by default.
 */
export async function loadLockRecord(userId: string): Promise<VaultPinRecord> {
  const db = getDb() as any;
  if (!db) throw new Error('app lock store unavailable');
  const snap = await getDoc(doc(db, VAULT_PIN_COLLECTION, userId));
  return snap.exists() ? readPinRecord(snap.data()) : emptyPinRecord();
}

/** Pure retryable transition. Responses, emails, audit and tickets must happen only after commit. */
export async function updateLockRecord<T>(userId: string, change: (record: VaultPinRecord) => { next?: VaultPinRecord; result: T }): Promise<T> {
  const db = getDb() as any;
  if (!db) throw new Error('app lock store unavailable');
  const ref = doc(db, VAULT_PIN_COLLECTION, userId);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? readPinRecord(snap.data()) : emptyPinRecord();
    const { next, result } = change(current);
    if (next) tx.set(ref, { user_id: userId, ...writePinRecord(next), updated_at: new Date() }, { merge: true });
    return result;
  });
}
