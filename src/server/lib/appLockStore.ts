/**
 * READING AND WRITING ONE USER'S APP-LOCK RECORD — the single Firestore door.
 *
 * Extracted from `routes/appLock.ts` the moment a SECOND caller needed it: the money routes now ask
 * "is this area locked?" before spending anything. Two copies of this read would be two places for the
 * collection name, the coercion and the failure behaviour to drift — and the failure behaviour here is
 * security-relevant, so that drift would be the dangerous kind.
 */
import { doc, getDoc, setDoc, getServerDb as getDb } from './serverDb';
import { readPinRecord, writePinRecord, emptyPinRecord, type VaultPinRecord } from './vaultPin';

/** Where each user's PIN hash, lock-out state, pending code and locked-area list live. One doc per user. */
export const VAULT_PIN_COLLECTION = 'user_vault_pin';

/**
 * Load one user's lock record, or a safe empty one.
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
  if (!db) return emptyPinRecord();
  const snap = await getDoc(doc(db, VAULT_PIN_COLLECTION, userId));
  return snap.exists() ? readPinRecord(snap.data()) : emptyPinRecord();
}

/**
 * Persist a lock record.
 *
 * 🔒 A FAILED WRITE MUST FAIL THE REQUEST, which is the opposite of how the audit log behaves, and the
 * difference is deliberate: this record holds the lock-out counter. If a wrong-PIN attempt could be
 * swallowed, an attacker whose writes always failed would get unlimited guesses — the lock-out would
 * silently stop existing. So every caller awaits this and answers an error if it throws.
 */
export async function saveLockRecord(userId: string, record: VaultPinRecord): Promise<void> {
  const db = getDb() as any;
  if (!db) throw new Error('app lock store unavailable');
  await setDoc(
    doc(db, VAULT_PIN_COLLECTION, userId),
    { user_id: userId, ...writePinRecord(record), updated_at: new Date() },
    { merge: true },
  );
}
