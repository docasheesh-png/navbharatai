// Durable state of the Native Cloud Build (2026-11-25): build jobs, upload keys, and key-use events.
//
// Everything that must survive a restart lives in Firestore — never in a process-local Map. Three
// collections, all server-only (the admin SDK; client rules give the browser no access):
//   • mobile_native_builds/{buildId}     — one row per build, the job record and its history.
//   • mobile_signing_keys/{keyId}        — one upload key per (user, application id), SEALED with the
//                                          platform secret key (secrets.ts, AES-256-GCM, rotatable).
//   • mobile_signing_key_events/{auto}   — the audit trail: imported / generated / used / deleted.
//
// 🔒 OWNERSHIP IS READ FROM THE STORED ROW, never from an id's shape. Build ids are random, key ids are
// hashes — but a guessable id must still never be enough to read somebody else's row.

import * as admin from 'firebase-admin';
import { createHash, randomBytes } from 'node:crypto';
import { getServerDb } from '../serverDb';
import { encrypt, decrypt } from '../secrets';
import { ACTIVE_STATES, isTerminalState, type MobileBuildState, type NativeBuildJob } from './types';

export const BUILDS = 'mobile_native_builds';
export const KEYS = 'mobile_signing_keys';
export const KEY_EVENTS = 'mobile_signing_key_events';

type Db = admin.firestore.Firestore;

let dbOverride: Db | null | undefined;
/** Tests inject an in-memory Firestore double; production uses the admin SDK. */
export function setNativeBuildDbForTests(db: Db | null | undefined): void { dbOverride = db; }

function db(): Db {
  if (dbOverride !== undefined) {
    if (!dbOverride) throw new Error('Database not available');
    return dbOverride;
  }
  if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
  const d = getServerDb();
  if (!d) throw new Error('Database not available');
  return d;
}

/**
 * The build id for one REQUEST. Derived from the owner and the client's idempotency key, so a double
 * click, a retried POST after a dropped connection, or a second tab replaying the same request lands on
 * the SAME row — one build, one charge. A new request (a new key) is a new build. PURE.
 */
export function nativeBuildId(userId: string, idempotencyKey: string): string {
  return 'nb_' + createHash('sha256').update(`${userId}\n${idempotencyKey}`).digest('hex').slice(0, 32);
}

export function isNativeBuildId(v: unknown): v is string {
  return typeof v === 'string' && /^nb_[0-9a-f]{32}$/.test(v);
}

export function isIdempotencyKey(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(v);
}

/** One upload key per (user, application id). PURE. */
export function signingKeyId(userId: string, appId: string): string {
  return 'sk_' + createHash('sha256').update(`${userId}\n${appId}`).digest('hex').slice(0, 40);
}

export function newRequestKey(): string {
  return randomBytes(18).toString('base64url');
}

// ── Build jobs ────────────────────────────────────────────────────────────────────────────────────

/** Create the job unless it already exists. Returns the stored row and whether THIS call created it. */
export async function createJobIfAbsent(job: NativeBuildJob): Promise<{ job: NativeBuildJob; created: boolean }> {
  const ref = db().collection(BUILDS).doc(job.id);
  return db().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists) {
      const existing = snap.data() as NativeBuildJob;
      if (existing.userId !== job.userId) throw new Error('Build id collision across owners');
      return { job: existing, created: false };
    }
    t.create(ref, job);
    return { job, created: true };
  });
}

export async function getJob(id: string): Promise<NativeBuildJob | null> {
  if (!isNativeBuildId(id)) return null;
  const snap = await db().collection(BUILDS).doc(id).get();
  return snap.exists ? (snap.data() as NativeBuildJob) : null;
}

/** The job, only if it belongs to `userId`. */
export async function getOwnedJob(id: string, userId: string): Promise<NativeBuildJob | null> {
  const job = await getJob(id);
  return job && job.userId === userId ? job : null;
}

/**
 * Patch a job. A terminal row is never moved again: once a build is completed/failed/cancelled its
 * verdict is final, so a late write from a slow driver cannot resurrect it (the zombie-write class).
 */
export async function updateJob(id: string, patch: Partial<NativeBuildJob>): Promise<NativeBuildJob | null> {
  const ref = db().collection(BUILDS).doc(id);
  return db().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const cur = snap.data() as NativeBuildJob;
    if (isTerminalState(cur.state) && patch.state !== 'expired') return cur;
    const next = { ...cur, ...patch } as NativeBuildJob;
    t.set(ref, next);
    return next;
  });
}

/** Ask a build to stop. Any instance can do this; the driving instance polls the flag. */
export async function requestCancel(id: string, userId: string): Promise<NativeBuildJob | null> {
  const ref = db().collection(BUILDS).doc(id);
  return db().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const cur = snap.data() as NativeBuildJob;
    if (cur.userId !== userId) return null;
    if (isTerminalState(cur.state)) return cur;
    const next: NativeBuildJob = cur.state === 'queued'
      ? { ...cur, cancelRequested: true, state: 'cancelled', finishedAt: new Date().toISOString(), errorCode: 'CANCELLED', errorMessage: 'You stopped this build.' }
      : { ...cur, cancelRequested: true, state: 'cancelling' };
    t.set(ref, next);
    return next;
  });
}

export async function listJobsForUser(userId: string, limit = 30): Promise<NativeBuildJob[]> {
  const snap = await db().collection(BUILDS).where('userId', '==', userId).get();
  const out: NativeBuildJob[] = [];
  snap.forEach((d) => { out.push(d.data() as NativeBuildJob); });
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Every active job in the system (bounded by the system concurrency cap, so this stays small). */
export async function listActiveJobs(): Promise<NativeBuildJob[]> {
  const snap = await db().collection(BUILDS).where('state', 'in', ACTIVE_STATES as MobileBuildState[]).get();
  const out: NativeBuildJob[] = [];
  snap.forEach((d) => { out.push(d.data() as NativeBuildJob); });
  return out;
}

// ── Upload keys ───────────────────────────────────────────────────────────────────────────────────

export interface StoredSigningKey {
  id: string;
  userId: string;
  appId: string;
  alias: string;
  certSha256: string;
  source: 'imported' | 'generated';
  keystoreSealed: string;
  storePassSealed: string;
  keyPassSealed: string;
  /** When the user explicitly agreed to NavBharatAI keeping this key. */
  consentAt: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What the browser may see about a key: never the key, never a password. */
export interface SigningKeyMeta {
  appId: string;
  alias: string;
  certSha256: string;
  source: 'imported' | 'generated';
  createdAt: string;
  lastUsedAt: string | null;
}

export function keyMeta(k: StoredSigningKey): SigningKeyMeta {
  return { appId: k.appId, alias: k.alias, certSha256: k.certSha256, source: k.source, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt };
}

export interface PlainSigningKey {
  keystore: Buffer;
  storePassword: string;
  keyPassword: string;
  alias: string;
  certSha256: string;
}

/** Seal with the platform key. `encrypt` refuses (throws) in production without a real key. */
function seal(v: string): string {
  const out = encrypt(v);
  if (!out) throw new Error('The signing key could not be sealed');
  return out;
}

function unseal(v: string): string {
  const out = decrypt(v);
  if (!out) throw new Error('The signing key could not be opened — it may have been sealed under a retired platform key');
  return out;
}

export async function getKeyRecord(userId: string, appId: string): Promise<StoredSigningKey | null> {
  const snap = await db().collection(KEYS).doc(signingKeyId(userId, appId)).get();
  if (!snap.exists) return null;
  const k = snap.data() as StoredSigningKey;
  return k.userId === userId && k.appId === appId ? k : null;
}

/**
 * Save an upload key. Refuses to replace an existing one unless `replace` is set — an app already on
 * Play is bound to its upload key, and silently swapping it would make the next upload fail.
 */
export async function saveKey(
  userId: string,
  appId: string,
  key: PlainSigningKey & { source: 'imported' | 'generated' },
  opts: { replace: boolean },
): Promise<{ ok: true; meta: SigningKeyMeta } | { ok: false; reason: 'exists' }> {
  const id = signingKeyId(userId, appId);
  const ref = db().collection(KEYS).doc(id);
  const now = new Date().toISOString();
  const row: StoredSigningKey = {
    id, userId, appId,
    alias: key.alias,
    certSha256: key.certSha256,
    source: key.source,
    keystoreSealed: seal(key.keystore.toString('base64')),
    storePassSealed: seal(key.storePassword),
    keyPassSealed: seal(key.keyPassword),
    consentAt: now,
    createdAt: now,
    lastUsedAt: null,
  };
  const replaced = await db().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (snap.exists && !opts.replace) return null;
    t.set(ref, row);
    return snap.exists;
  });
  if (replaced === null) return { ok: false, reason: 'exists' };
  await recordKeyEvent(userId, appId, replaced ? 'replaced' : key.source, null);
  return { ok: true, meta: keyMeta(row) };
}

/** Open a key for ONE signing. The plaintext lives only in this call's memory and the signing machine. */
export async function openKeyForSigning(userId: string, appId: string, buildId: string): Promise<PlainSigningKey | null> {
  const k = await getKeyRecord(userId, appId);
  if (!k) return null;
  const plain: PlainSigningKey = {
    keystore: Buffer.from(unseal(k.keystoreSealed), 'base64'),
    storePassword: unseal(k.storePassSealed),
    keyPassword: unseal(k.keyPassSealed),
    alias: k.alias,
    certSha256: k.certSha256,
  };
  await db().collection(KEYS).doc(k.id).update({ lastUsedAt: new Date().toISOString() }).catch(() => {});
  await recordKeyEvent(userId, appId, 'used', buildId);
  return plain;
}

export async function deleteKey(userId: string, appId: string): Promise<boolean> {
  const k = await getKeyRecord(userId, appId);
  if (!k) return false;
  await db().collection(KEYS).doc(k.id).delete();
  await recordKeyEvent(userId, appId, 'deleted', null);
  return true;
}

export async function recordKeyEvent(
  userId: string, appId: string,
  event: 'imported' | 'generated' | 'replaced' | 'used' | 'deleted',
  buildId: string | null,
): Promise<void> {
  try {
    await db().collection(KEY_EVENTS).add({ keyId: signingKeyId(userId, appId), userId, appId, event, buildId, at: new Date().toISOString() });
  } catch { /* the audit write must never fail a build; the build row itself records the key use */ }
}
