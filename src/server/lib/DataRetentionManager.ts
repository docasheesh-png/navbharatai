// P-DATA.4 — Data Retention + Deletion (DPDP / GDPR right-to-be-forgotten).
//
// Two capabilities, both operating on the platform's OWN user data (not generated apps):
//   1. deleteUserData(uid) — the right-to-be-forgotten cascade: delete every user-scoped record for a
//      single user across all collections in the VERIFIED registry below. Exact-match only (doc-id == uid
//      or a verified `userId` field == uid) — it NEVER runs a broad/prefix query that could over-delete.
//   2. purgeExpired(now) — TTL retention: delete records in RETENTION_POLICIES older than their cutoff.
//
// The Firestore surface is injected (RetentionFirestore) so this is unit-testable without Firebase and
// works directly with the firebase-admin `Firestore` instance in production. Pure helpers (cutoff,
// isExpired) are separated so the policy math is testable without any I/O.
//
// SAFETY: every collection's key strategy in USER_SCOPED_COLLECTIONS was verified against its real
// read/write path before being added — a wrong strategy would either miss data (compliance fail) or
// delete the wrong user's data (catastrophic), so nothing is added on a guess.

import * as admin from 'firebase-admin';

// ── Injected Firestore surface (satisfied by admin.firestore.Firestore and by the test mock) ──────
export interface RetentionDocRef {
  get(): Promise<{ exists: boolean }>;
  delete(): Promise<unknown>;
}
export interface RetentionQuery {
  get(): Promise<{ docs: Array<{ ref: { delete(): Promise<unknown> } }> }>;
}
export interface RetentionCollection {
  doc(id: string): RetentionDocRef;
  where(field: string, op: '==' | '<', value: unknown): RetentionQuery;
}
export interface RetentionFirestore {
  collection(name: string): RetentionCollection;
}

// ── The verified registry of user-scoped collections ─────────────────────────────────────────────
/** How a collection is keyed to a user: the doc-id IS the uid, or a field equals the uid. */
export type KeyStrategy = 'docId' | { field: string };
export interface UserScopedCollection { collection: string; key: KeyStrategy; }

/**
 * Every collection here was verified against its read/write path:
 *  - users / user_profiles / user_sessions / user_token_wallets → doc id IS the uid
 *  - user_costs / user_build_history / chat_sessions            → a `userId` field equals the uid
 */
export const USER_SCOPED_COLLECTIONS: readonly UserScopedCollection[] = [
  { collection: 'users', key: 'docId' },
  { collection: 'user_profiles', key: 'docId' },
  { collection: 'user_sessions', key: 'docId' },
  { collection: 'user_token_wallets', key: 'docId' },
  { collection: 'user_costs', key: { field: 'userId' } },
  { collection: 'user_build_history', key: { field: 'userId' } },
  { collection: 'chat_sessions', key: { field: 'userId' } },
];

// ── TTL retention policies ────────────────────────────────────────────────────────────────────────
export interface RetentionPolicy { collection: string; ttlDays: number; timestampField: string; }
/**
 * Only VERIFIED-safe policies are enabled by default. `build_jobs.updatedAt` is a real Date, so a
 * `< cutoff` bound deletes only genuinely-old jobs (never recent ones). More collections are added as
 * each one's timestamp field + type is verified — additions are pure config, no code change.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { collection: 'build_jobs', ttlDays: 90, timestampField: 'updatedAt' },
];

// ── Pure policy math (no I/O) ──────────────────────────────────────────────────────────────────────
export function retentionCutoffMs(nowMs: number, ttlDays: number): number {
  return nowMs - ttlDays * 24 * 60 * 60 * 1000;
}
export function isExpired(docTimestampMs: number, cutoffMs: number): boolean {
  return Number.isFinite(docTimestampMs) && docTimestampMs < cutoffMs;
}

// ── Right-to-be-forgotten cascade ──────────────────────────────────────────────────────────────────
export interface CollectionResult { collection: string; deleted: number; error?: string; }
export interface DeletionReport { uid: string; collections: CollectionResult[]; totalDeleted: number; }

/**
 * Delete EVERY user-scoped record for `uid` across the verified registry. Exact-match only. Best-effort
 * per collection: a failure on one collection is recorded and the cascade continues (so a single flaky
 * collection can't leave the rest of the user's data behind). Throws only on an empty uid — deleting
 * with an empty key would be catastrophic, so it is refused outright.
 */
export async function deleteUserData(db: RetentionFirestore, uid: string): Promise<DeletionReport> {
  if (!uid || typeof uid !== 'string') {
    throw new Error('deleteUserData: a non-empty uid is required (refusing to delete with an empty key).');
  }
  const collections: CollectionResult[] = [];
  for (const entry of USER_SCOPED_COLLECTIONS) {
    let deleted = 0;
    try {
      if (entry.key === 'docId') {
        const ref = db.collection(entry.collection).doc(uid);
        const snap = await ref.get();
        if (snap.exists) { await ref.delete(); deleted = 1; }
      } else {
        const q = await db.collection(entry.collection).where(entry.key.field, '==', uid).get();
        for (const d of q.docs) { await d.ref.delete(); deleted++; }
      }
      collections.push({ collection: entry.collection, deleted });
    } catch (e) {
      collections.push({ collection: entry.collection, deleted, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { uid, collections, totalDeleted: collections.reduce((s, r) => s + r.deleted, 0) };
}

// ── TTL purge ───────────────────────────────────────────────────────────────────────────────────────
export interface PurgeResult { collection: string; deleted: number; cutoffMs: number; error?: string; }
export interface PurgeReport { collections: PurgeResult[]; totalDeleted: number; }

/**
 * Delete records older than each policy's TTL. Uses a `< cutoff` bound so it can only ever remove OLD
 * data (never recent). Best-effort per policy. `policies` is injectable for tests.
 */
export async function purgeExpired(
  db: RetentionFirestore,
  nowMs: number,
  policies: readonly RetentionPolicy[] = RETENTION_POLICIES,
): Promise<PurgeReport> {
  const collections: PurgeResult[] = [];
  for (const policy of policies) {
    const cutoffMs = retentionCutoffMs(nowMs, policy.ttlDays);
    let deleted = 0;
    try {
      const q = await db.collection(policy.collection).where(policy.timestampField, '<', new Date(cutoffMs)).get();
      for (const d of q.docs) { await d.ref.delete(); deleted++; }
      collections.push({ collection: policy.collection, deleted, cutoffMs });
    } catch (e) {
      collections.push({ collection: policy.collection, deleted, cutoffMs, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { collections, totalDeleted: collections.reduce((s, r) => s + r.deleted, 0) };
}

// ── Production admin Firestore accessor (VITEST-skip, mirrors UserProfileStore) ──────────────────────
let cachedDb: admin.firestore.Firestore | null = null;
export function getRetentionDb(): RetentionFirestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!cachedDb) {
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      cachedDb = admin.firestore();
    }
    return cachedDb as unknown as RetentionFirestore;
  } catch {
    return null;
  }
}
