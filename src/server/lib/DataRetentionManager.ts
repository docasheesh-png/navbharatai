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
import { getServerDb } from './serverDb';

// ── Injected Firestore surface (satisfied by admin.firestore.Firestore and by the test mock) ──────
export interface RetentionDocRef {
  get(): Promise<{ exists: boolean }>;
  delete(): Promise<unknown>;
}
export interface RetentionQuery {
  get(): Promise<{ docs: Array<{ ref: { delete(): Promise<unknown> } }> }>;
  /**
   * Bound one purge run. Optional so an existing caller or mock without it still works, but the purge
   * always ASKS — see `maxPerRun`: the first run against a collection with months of backlog would
   * otherwise be an unbounded read-and-delete of everything at once.
   */
  limit?(n: number): RetentionQuery;
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
  /**
   * 🔒 `takedown_records` IS DELIBERATELY ABSENT, and must stay absent.
   *
   * It looks like it belongs here — it carries a uid — and adding it would feel like completing the
   * list. It would also destroy the one record the retention duty exists for: deleting an account
   * must not erase why that account's app was taken down. It has its own 180-day TTL policy below
   * instead, and the exception is disclosed in the Privacy Policy (§6) and on the Grievance page.
   *
   * 🔒 SO IS `safety_flags`, for the sharper version of the same reason: a record of abuse that the
   * abuser can erase by pressing "delete my account" is not a record. It has its own 180-day policy
   * and is disclosed in the same place.
   */
];

// ── TTL retention policies ────────────────────────────────────────────────────────────────────────

/**
 * How a collection's timestamp is actually STORED. Required on every policy, deliberately.
 *
 * 🔴 THIS IS THE DEFECT THAT MADE THE FIELD REQUIRED (ROADMAP §12 #3). The purge used to build its
 * bound as `new Date(cutoffMs)` unconditionally, which is correct ONLY for a field stored as a Date.
 * Firestore orders values BY TYPE FIRST — every number sorts before every timestamp — so a policy on a
 * numeric `Date.now()` field would match **nothing, forever**, while reporting itself configured and
 * deleting zero documents with no error. That is the "built but not really working" state the second
 * absolute rule forbids, and it would have been invisible: a purge that deletes nothing looks exactly
 * like a purge with nothing to delete.
 *
 * An OPTIONAL field with a default would reintroduce it — the wrong guess would ship silently. So every
 * policy states the type, and every type below was read off the collection's real write path.
 */
export type TimestampKind =
  /** `new Date()` / a Firestore Timestamp. */
  | 'date'
  /** `Date.now()` — epoch milliseconds as a plain number. */
  | 'epochMs'
  /** `new Date().toISOString()` — sorts lexicographically in time order, so `<` is correct. */
  | 'iso';

export interface RetentionPolicy {
  collection: string;
  ttlDays: number;
  timestampField: string;
  /** How the field is stored. See TimestampKind — a wrong value silently deletes nothing. */
  timestampKind: TimestampKind;
  /** Documents deleted per run. Defaults to DEFAULT_MAX_PER_RUN; the purge is never unbounded. */
  maxPerRun?: number;
}

/**
 * How many documents one policy may delete in a single run.
 *
 * The purge had no bound at all. On the first run against a collection carrying months of backlog that
 * is one query returning everything and then a delete per document — a spike of reads, writes and
 * memory on a schedule. Bounded, a backlog drains over successive runs instead, which is slower and
 * cannot hurt anything.
 */
export const DEFAULT_MAX_PER_RUN = 500;

/**
 * The bound to compare against, in the type the field is actually stored in. PURE.
 */
export function retentionBound(cutoffMs: number, kind: TimestampKind): Date | number | string {
  if (kind === 'epochMs') return cutoffMs;
  if (kind === 'iso') return new Date(cutoffMs).toISOString();
  return new Date(cutoffMs);
}

/**
 * ⚠️ ONLY OPERATIONAL DATA IS ON A CLOCK. Every policy here was verified against its write path for
 * BOTH the field name and the stored type, and every one of these collections is data NavBharatAI
 * generated about itself — logs, metrics, transient session scratch — never a user's own property.
 * See RETAINED_INDEFINITELY below for the collections that must never be on a timer, and why.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  /**
   * Removal records — the OTHER half of the 180-day duty (IT Rules, 2021 Rule 3(1)(g)).
   *
   * The duty is two-sided and only one side gets remembered: the record must SURVIVE 180 days, and
   * it must not be kept for ever. `takedownLedger.ts` keeps it out of USER_SCOPED_COLLECTIONS so an
   * account deletion cannot erase it early; this policy is what stops it becoming a permanent file
   * on somebody long after the law stopped asking for it.
   *
   * `removedAt: Date.now()` — a plain number, so `epochMs`. A wrong kind here would silently delete
   * nothing for ever, which is exactly the defect that made this field required.
   */
  { collection: 'takedown_records', ttlDays: 180, timestampField: 'removedAt', timestampKind: 'epochMs' },
  /**
   * Flagged messages — the same 180-day story as the removal records above, and for the same reason:
   * an abuse record must outlive the account (see the exclusion note in USER_SCOPED_COLLECTIONS) and
   * must not become a permanent file. `at: Date.now()` ⇒ `epochMs`.
   */
  { collection: 'safety_flags', ttlDays: 180, timestampField: 'at', timestampKind: 'epochMs' },
  // `updatedAt: new Date()` — BuildJobManager. The original policy; its type is now stated rather
  // than assumed by the purge.
  { collection: 'build_jobs', ttlDays: 90, timestampField: 'updatedAt', timestampKind: 'date' },
  // `ts: Date.now()` — logStore. Server logs, the fastest-growing operational collection.
  { collection: 'server_logs', ttlDays: 30, timestampField: 'ts', timestampKind: 'epochMs' },
  // `updatedAt: Date.now()` — metricsStore. ONE document per calendar day, so a long window is cheap
  // and keeps year-over-year comparison possible.
  { collection: 'metrics_snapshots', ttlDays: 400, timestampField: 'updatedAt', timestampKind: 'epochMs' },
  // `savedAt: Date.now()` — ProBuildSession. A finished build's transient session result.
  { collection: 'build_sessions', ttlDays: 90, timestampField: 'savedAt', timestampKind: 'epochMs' },
  // `updatedAt: new Date().toISOString()` — ErrorPatternStore. Per-session hints, regenerated freely.
  { collection: 'session_error_hints', ttlDays: 30, timestampField: 'updatedAt', timestampKind: 'iso' },
];

/**
 * 🔒 COLLECTIONS THAT MUST NEVER BE PURGED ON A CLOCK, with the reason recorded next to each.
 *
 * This exists because "every growing collection needs retention" is wrong, and acting on it would
 * delete users' work. A collection grows for two very different reasons: because the platform keeps
 * writing about itself (bounded by a clock, above), or because USERS keep creating things — and the
 * second is not garbage to be swept, it is the product. The right mechanism for these is deletion on
 * ACCOUNT deletion (`deleteUserData`, which already covers the user-scoped ones) or a per-user cap —
 * never age.
 *
 * It is also what stops the Load board warning forever about collections that are correct as they are:
 * a warning nobody can ever clear is a warning nobody reads.
 */
export const RETAINED_INDEFINITELY: readonly { collection: string; reason: string }[] = [
  { collection: 'workspace_files_v3', reason: "the user's actual app source code" },
  { collection: 'workspace_assets_v3', reason: "the user's uploaded images and files" },
  { collection: 'workspace_checkpoints_v3', reason: 'the restore points a user rolls back to' },
  { collection: 'workspace_memory_v3', reason: "what the engine has learned about the user's app" },
  { collection: 'workspace_manual_edits_v3', reason: "the user's own hand edits, which must not be overwritten" },
  { collection: 'workspace_embeddings_v3', reason: "a derived index of the user's code — deleting it degrades their builds" },
  { collection: 'workspace_diagnostics_v3', reason: 'one report per workspace, replaced in place — it does not grow with time' },
  { collection: 'project_plans_v3', reason: "the plan the user's app is being built against" },
  { collection: 'app_builds', reason: "the user's own build record" },
  { collection: 'user_build_history', reason: "the user's own history; removed with their account, not with age" },
  { collection: 'user_costs', reason: 'money. A billing record deleted on a timer cannot be reconciled or disputed' },
  { collection: 'hosting_usage', reason: 'per-user metering that the bill is derived from' },
];

/** Is this collection deliberately kept forever, rather than merely missing a policy? PURE. */
export function isRetainedIndefinitely(collection: string): boolean {
  return RETAINED_INDEFINITELY.some((r) => r.collection === collection);
}

/**
 * Collections that GROW and have neither a policy nor a documented reason to keep forever — i.e. the
 * ones a human still has to decide about. This is the number the Load board should show. PURE.
 */
export function collectionsNeedingRetention(
  growing: readonly string[],
  policies: readonly RetentionPolicy[] = RETENTION_POLICIES,
): string[] {
  return (growing || []).filter(
    (c) => !policies.some((p) => p.collection === c) && !isRetainedIndefinitely(c),
  );
}

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
      // The bound is built in the type the field is STORED in — see TimestampKind. A Date bound against
      // a numeric field matches nothing in Firestore, silently.
      let q = db.collection(policy.collection)
        .where(policy.timestampField, '<', retentionBound(cutoffMs, policy.timestampKind));
      const cap = Math.max(1, Math.floor(policy.maxPerRun ?? DEFAULT_MAX_PER_RUN));
      if (typeof q.limit === 'function') q = q.limit(cap);
      const snap = await q.get();
      for (const d of snap.docs) { await d.ref.delete(); deleted++; }
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
      cachedDb = getServerDb();
    }
    return cachedDb as unknown as RetentionFirestore;
  } catch {
    return null;
  }
}
