/** User-account session revocation. No passwords, admin sessions or provider credentials change. */
import { doc, getDoc, getServerDb, runTransaction } from './serverDb';

export const SESSION_REVOCATIONS_COLLECTION = 'session_revocations';
export const SESSION_REVOKE_LIMIT = 5;
const WINDOW_MS = 3_600_000;

/** The same authority as Firestore rules, read freshly for each protected request. Fail closed. */
export async function readSessionCutoff(uid: string): Promise<number> {
  const db = getServerDb();
  if (!db) throw new Error('Session authority unavailable');
  const snap = await getDoc(doc(db, SESSION_REVOCATIONS_COLLECTION, uid));
  if (!snap.exists()) return 0;
  const cutoff: unknown = snap.data()?.revokeTime;
  if (!Number.isSafeInteger(cutoff) || (cutoff as number) < 0) throw new Error('Invalid session authority');
  return cutoff as number;
}

/** The exchange claim preserves the ORIGINAL phone sign-in even after a custom-token handover. */
export function sessionTokenIsCurrent(token: { auth_time?: number; session_auth_time?: number; firebase?: { sign_in_provider?: string } }, cutoff: number): boolean {
  if (cutoff === 0) return true;
  if (token.firebase?.sign_in_provider === 'custom' && token.session_auth_time === undefined) return false;
  return typeof token.auth_time === 'number' && Number.isSafeInteger(token.auth_time) && token.auth_time >= cutoff
    && (token.session_auth_time === undefined
      || (Number.isSafeInteger(token.session_auth_time) && token.session_auth_time >= cutoff));
}

export interface SessionRevocationAuth {
  revokeRefreshTokens(uid: string): Promise<void>;
  getUser(uid: string): Promise<{ tokensValidAfterTime?: string }>;
}
export interface SessionRevocationStore {
  reserve(uid: string, nowMs: number): Promise<boolean>;
  advance(uid: string, revokeTime: number): Promise<void>;
}

/** A single server-only document is both the rate bucket and the rules' monotonic cutoff. */
export function sessionRevocationStore(): SessionRevocationStore | null {
  const db = getServerDb();
  if (!db) return null;
  return {
    reserve: (uid, nowMs) => runTransaction(db, async (tx) => {
      const ref = doc(db, SESSION_REVOCATIONS_COLLECTION, uid);
      const snap = await tx.get(ref);
      const old = snap.exists() ? snap.data() : {};
      const window = Math.floor(nowMs / WINDOW_MS);
      const used = old.window === window ? Number(old.count) : 0;
      // A corrupt bucket/cutoff is not an invitation to reset its security authority.
      if (snap.exists() && (!Number.isSafeInteger(old.revokeTime) || old.revokeTime < 0)) throw new Error('Invalid session cutoff');
      if (!Number.isSafeInteger(used) || used < 0) throw new Error('Invalid session rate');
      if (used >= SESSION_REVOKE_LIMIT) return false;
      tx.set(ref, { revokeTime: old.revokeTime ?? 0, window, count: used + 1 });
      return true;
    }),
    advance: (uid, revokeTime) => runTransaction(db, async (tx) => {
      if (!Number.isSafeInteger(revokeTime) || revokeTime <= 0) throw new Error('Invalid session cutoff');
      const ref = doc(db, SESSION_REVOCATIONS_COLLECTION, uid);
      const snap = await tx.get(ref);
      const old = snap.exists() ? snap.data() : {};
      if (snap.exists() && (!Number.isSafeInteger(old.revokeTime) || old.revokeTime < 0)) throw new Error('Invalid session cutoff');
      tx.set(ref, { revokeTime: Math.max(old.revokeTime ?? 0, revokeTime) }, { merge: true });
    }),
  };
}

export type RevokeSessionsResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; code: 'rate-limited' | 'revocation-unconfirmed' };

/**
 * UID and authTime come ONLY from a verified, non-revoked ID token at the route boundary.
 * Firebase cutoffs have second precision. Wait one second before invalidation so a session that
 * signed in during this request's second is not accidentally left valid at the equality boundary.
 * The returned cutoff must also be strictly newer than the initiating session's provider auth_time.
 * A failed/uncertain provider or mirror write NEVER becomes success. No automatic mutation retry.
 */
export async function revokeAccountSessions(
  uid: string,
  authTime: number | undefined,
  auth: SessionRevocationAuth | null,
  store: SessionRevocationStore | null,
  deps: { now?: () => number; wait?: (ms: number) => Promise<void> } = {},
): Promise<RevokeSessionsResult> {
  const uncertain = { ok: false, status: 503, code: 'revocation-unconfirmed' } as const;
  if (!uid || !auth || !store || !Number.isSafeInteger(authTime) || !(authTime! > 0)) return uncertain;
  try {
    const startSecond = Math.floor((deps.now ?? Date.now)() / 1000);
    if (!await store.reserve(uid, startSecond * 1000)) return { ok: false, status: 429, code: 'rate-limited' };
    await (deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(1000);
    await auth.revokeRefreshTokens(uid);
    const user = await auth.getUser(uid);
    const revokeTime = Date.parse(user.tokensValidAfterTime ?? '') / 1000;
    if (!Number.isSafeInteger(revokeTime) || revokeTime <= authTime! || revokeTime < startSecond + 1) return uncertain;
    // Replaying the SAME monotonic max write is safe after a lost acknowledgement. Never repeat
    // revokeRefreshTokens: that would also revoke a genuinely new sign-in made during recovery.
    try { await store.advance(uid, revokeTime); }
    catch { await store.advance(uid, revokeTime); }
    return { ok: true };
  } catch {
    return uncertain;
  }
}
