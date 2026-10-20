// Firestore adapter for the shared database. Admin SDK only — security rules deny this collection
// to every client. Callers pass the database in, so a test can pass a fake and production can pass
// getServerDb(). This file does not charge anyone.

import { BoundedCache } from './boundedCache';
import {
  SHARED_DATA_OPS_CAP, SHARED_COLLECTION_RE, SHARED_DATA_MAX_LIST, SHARED_DATA_SHARDS, SHARED_DATA_START_LOCK_MS, SHARED_RECORD_ID_RE,
  decideDataOp, gateSharedCall, hashApiKey, newApiKey, newRecordId, publicRefFor,
  type DecideResult, type SharedMeta, type SharedRecord, type SharedScalar,
} from './sharedData';

type DocRef = {
  path: string;
  get(): Promise<Snap>;
  collection(path: string): ReturnType<SharedDb['collection']>;
};
type Snap = { exists: boolean; data: () => SharedMeta | SharedRecord | { n?: number } | undefined; ref?: DocRef };
type Tx = {
  get(ref: DocRef): Promise<Snap>;
  set(ref: DocRef, data: unknown, opts?: { merge?: boolean }): void;
  delete(ref: DocRef): void;
};
type QuerySnap = { empty: boolean; size: number; docs: Array<{ id: string; data: () => SharedRecord; ref: DocRef }> };

export interface SharedQuery {
  limit(n: number): { get(): Promise<QuerySnap> };
  where(field: string, op: string, value: string): SharedQuery;
  orderBy(field: string): SharedQuery;
  startAfter(value: string): SharedQuery;
}
export interface SharedDb {
  collection(path: string): SharedQuery & { doc(id: string): DocRef };
  batch(): { delete(ref: DocRef): void; commit(): Promise<void> };
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

// A hot exhausted app must not issue record queries on every refused call. This is only a short
// negative cache; the durable transaction below owns the quota across instances and renewals.
const exhausted = new BoundedCache<string, true>({ maxEntries: 20_000, ttlMs: 15_000 });

function metaRef(db: SharedDb, workspaceId: string): DocRef {
  return db.collection('nbai_app_data').doc(workspaceId);
}

function shardRef(db: SharedDb, workspaceId: string, shard: number): DocRef {
  return db.collection('nbai_app_data').doc(workspaceId).collection('ops').doc(String(shard));
}

function recordRef(db: SharedDb, workspaceId: string, collection: string, id: string): DocRef {
  return db.collection('nbai_app_data').doc(workspaceId).collection('records').doc(`${collection}_${id}`);
}

function asMeta(data: unknown): SharedMeta | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Partial<SharedMeta>;
  if (typeof m.workspaceId !== 'string' || typeof m.keyHash !== 'string' || typeof m.expiresAt !== 'string') return null;
  return {
    workspaceId: m.workspaceId,
    ownerUid: typeof m.ownerUid === 'string' ? m.ownerUid : '',
    keyHash: m.keyHash,
    publicRef: typeof m.publicRef === 'string' ? m.publicRef : '',
    expiresAt: m.expiresAt,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : '',
    ready: m.ready === true,
    ...(typeof m.opsUsed === 'number' && Number.isFinite(m.opsUsed) && m.opsUsed >= 0 ? { opsUsed: m.opsUsed } : {}),
    docCount: typeof m.docCount === 'number' && Number.isFinite(m.docCount) ? m.docCount : 0,
  };
}

function asRecord(data: unknown): SharedRecord | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Partial<SharedRecord>;
  if (typeof r.collection !== 'string' || typeof r.id !== 'string' || !r.data || typeof r.data !== 'object') return null;
  return {
    createdBy: typeof r.createdBy === 'string' ? r.createdBy : undefined,
    scope: typeof r.scope === 'string' ? r.scope : undefined,
    collection: r.collection,
    id: r.id,
    data: r.data as Record<string, SharedScalar>,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
  };
}

export interface CreateSharedInput {
  workspaceId: string;
  ownerUid: string;
  expiresAtMs: number;
  nowMs: number;
}

export async function createSharedDatabase(
  db: SharedDb,
  input: CreateSharedInput,
): Promise<{ ok: true; publicRef: string; key: string } | { ok: false; message: string; cleaned: boolean }> {
  const key = newApiKey();
  const nowIso = new Date(input.nowMs).toISOString();
  try {
    const outcome = await db.runTransaction(async (tx) => {
      const ref = metaRef(db, input.workspaceId);
      const snap = await tx.get(ref);
      const current = snap.exists ? asMeta(snap.data()) : null;
      const exp = current ? Date.parse(current.expiresAt) : NaN;
      const updated = current ? Date.parse(current.updatedAt) : NaN;
      const locked = !!current
        && Number.isFinite(exp) && exp > input.nowMs
        && (current.ready || (Number.isFinite(updated) && input.nowMs - updated < SHARED_DATA_START_LOCK_MS));
      if (locked && current) return current.ready ? 'exists' as const : 'starting' as const;
      const meta: SharedMeta = {
        workspaceId: input.workspaceId,
        ownerUid: input.ownerUid,
        keyHash: hashApiKey(key),
        publicRef: publicRefFor(input.workspaceId),
        expiresAt: new Date(input.expiresAtMs).toISOString(),
        updatedAt: nowIso,
        ready: false,
        docCount: current?.docCount ?? 0,
        opsUsed: 0,
      };
      tx.set(ref, meta);
      for (let i = 0; i < SHARED_DATA_SHARDS; i++) tx.set(shardRef(db, input.workspaceId, i), { n: 0 });
      return 'created' as const;
    });
    if (outcome === 'exists') {
      return { ok: false, message: 'This app already has a database. Nothing was charged.', cleaned: true };
    }
    if (outcome === 'starting') {
      return { ok: false, message: 'A database is already being started for this app. Do not press again. Nothing was charged.', cleaned: true };
    }
    return { ok: true, publicRef: publicRefFor(input.workspaceId), key };
  } catch {
    return { ok: false, message: 'The database could not be created. Nothing was charged.', cleaned: true };
  }
}

export async function markSharedReady(db: SharedDb, workspaceId: string, nowMs: number): Promise<boolean> {
  try {
    await db.runTransaction(async (tx) => {
      const ref = metaRef(db, workspaceId);
      const snap = await tx.get(ref);
      const current = snap.exists ? asMeta(snap.data()) : null;
      if (!current) throw new Error('missing');
      tx.set(ref, { ...current, ready: true, updatedAt: new Date(nowMs).toISOString() });
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * RESELL_AUTO_RENEW: a renewed small database gets its new period on the data API itself, and a
 * fresh operations allowance (the cap is per 30 days). The key does not change, so the published
 * app keeps working with no republish. Records are untouched.
 */
export async function extendSharedDatabase(db: SharedDb, workspaceId: string, expiresAtMs: number, nowMs: number): Promise<boolean> {
  try {
    await db.runTransaction(async (tx) => {
      const ref = metaRef(db, workspaceId);
      const snap = await tx.get(ref);
      const current = snap.exists ? asMeta(snap.data()) : null;
      if (!current) throw new Error('missing');
      const curExp = Date.parse(current.expiresAt);
      // Never shortens a period (a replay of an older renewal is a no-op).
      if (Number.isFinite(curExp) && curExp >= expiresAtMs) return;
      tx.set(ref, { ...current, opsUsed: 0, expiresAt: new Date(expiresAtMs).toISOString(), updatedAt: new Date(nowMs).toISOString() });
      exhausted.delete(`${workspaceId}:${current.keyHash}`);
      for (let i = 0; i < SHARED_DATA_SHARDS; i++) tx.set(shardRef(db, workspaceId, i), { n: 0 });
    });
    return true;
  } catch {
    return false;
  }
}

export async function destroySharedDatabase(db: SharedDb, workspaceId: string): Promise<{ ok: boolean }> {
  try {
    const records = db.collection(`nbai_app_data/${workspaceId}/records`);
    for (let round = 0; round < 20; round++) {
      const snap = await records.limit(200).get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
      if (snap.size < 200) break;
    }
    const left = await records.limit(1).get();
    if (!left.empty) return { ok: false };
    const ops = db.collection(`nbai_app_data/${workspaceId}/ops`);
    const shards = await ops.limit(20).get();
    if (!shards.empty) {
      const batch = db.batch();
      for (const doc of shards.docs) batch.delete(doc.ref);
      await batch.commit();
    }
    await db.runTransaction(async (tx) => {
      tx.delete(metaRef(db, workspaceId));
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export interface DataCall {
  /** Trusted, server-verified identity. Never copied from request body/headers. */
  actorUid?: string;
  cursor?: string;
  op: 'list' | 'get' | 'create' | 'replace' | 'delete';
  collection: string;
  id: string | null;
  key: string;
  nowMs: number;
  data: Record<string, SharedScalar> | null;
}

export async function runSharedData(
  db: SharedDb,
  workspaceId: string,
  call: DataCall,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const fail = (status: number, error: string) => ({ status, body: { ok: false, error } });
  if (!call.actorUid) return fail(401, 'Sign in before accessing this app database.');
  if (!SHARED_COLLECTION_RE.test(call.collection)) return fail(400, 'That collection name is not allowed. Nothing was changed.');
  if (call.cursor && !SHARED_RECORD_ID_RE.test(call.cursor)) return fail(400, 'That page cursor is not allowed.');
  if (call.op !== 'create' && call.op !== 'list' && !SHARED_RECORD_ID_RE.test(call.id || '')) return fail(400, 'That record id is not allowed.');
  const keyHash = hashApiKey(call.key);
  const cacheKey = `${workspaceId}:${keyHash}`;
  const quotaError = 'This database has used the operations included in these 30 days; nothing extra was charged. Retry after renewal.';
  if (exhausted.get(cacheKey, call.nowMs)) return fail(429, quotaError);
  const id = call.op === 'create' ? (call.id && SHARED_RECORD_ID_RE.test(call.id) ? call.id : newRecordId()) : call.id;
  try {
    // Reserve BEFORE querying records. All instances transact on the same durable counter. Old
    // databases import the old shard totals once; existing records and credentials are kept.
    const admitted = await db.runTransaction(async (tx) => {
      const ref = metaRef(db, workspaceId);
      const snap = await tx.get(ref);
      const meta = snap.exists ? asMeta(snap.data()) : null;
      const gate = gateSharedCall(meta, keyHash, call.nowMs);
      if (!gate.ok) return { error: fail(gate.status, gate.error) };
      if (!meta) throw new Error('missing');
      let used = meta.opsUsed;
      if (used === undefined) {
        const shards = await Promise.all(Array.from({ length: SHARED_DATA_SHARDS }, (_, i) => tx.get(shardRef(db, workspaceId, i))));
        used = shards.reduce((sum, shard) => { const n = (shard.data() as { n?: number } | undefined)?.n; return sum + (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0); }, 0);
      }
      const remaining = Math.max(0, SHARED_DATA_OPS_CAP - used);
      if (remaining === 0) return { error: fail(429, quotaError) };
      const reserved = call.op === 'list' ? Math.min(SHARED_DATA_MAX_LIST, remaining) : 1;
      tx.set(ref, { ...meta, opsUsed: used + reserved });
      return { meta, reserved };
    });
    if ('error' in admitted) {
      if (admitted.error?.status === 429) exhausted.set(cacheKey, true, call.nowMs);
      return admitted.error!;
    }
    const { meta, reserved } = admitted;
    if (call.op === 'list') {
      const field = call.actorUid === meta.ownerUid ? 'collection' : 'scope';
      const value = field === 'collection' ? call.collection : `${call.collection}:${call.actorUid}`;
      let query = db.collection(`nbai_app_data/${workspaceId}/records`).where(field, '==', value).orderBy('__name__');
      if (call.cursor) query = query.startAfter(`${call.collection}_${call.cursor}`);
      const page = await query.limit(reserved).get();
      const rows = page.docs.map((d) => asRecord(d.data())).filter((r): r is SharedRecord => r !== null && (call.actorUid === meta.ownerUid || r.createdBy === call.actorUid));
      const used = Math.max(1, page.docs.length);
      if (used < reserved) {
        await db.runTransaction(async (tx) => {
          const ref = metaRef(db, workspaceId); const snap = await tx.get(ref); const current = snap.exists ? asMeta(snap.data()) : null;
          // A renewal or key rotation must never receive a refund from an earlier period.
          if (current && current.expiresAt === meta.expiresAt && current.keyHash === meta.keyHash) tx.set(ref, { ...current, opsUsed: Math.max(0, (current.opsUsed ?? 0) - (reserved - used)) });
        });
      }
      return { status: 200, body: { ok: true, records: rows.map((r) => ({ id: r.id, record: r.data })), nextCursor: page.docs.length === reserved ? rows.at(-1)?.id ?? null : null } };
    }
    return await db.runTransaction(async (tx) => {
      const ref = metaRef(db, workspaceId);
      const metaSnap = await tx.get(ref);
      const current = metaSnap.exists ? asMeta(metaSnap.data()) : null;
      const rec = recordRef(db, workspaceId, call.collection, id!);
      const recordSnap = await tx.get(rec);
      const record = recordSnap.exists ? asRecord(recordSnap.data()) : null;
      const decision: DecideResult = decideDataOp({
        meta: current, actorUid: call.actorUid, opsCount: 0, nowMs: call.nowMs, keyHash,
        op: call.op, collection: call.collection, id, record, listCount: 0,
        data: call.op === 'replace' && record && call.data ? { ...record.data, ...call.data } : call.data,
      });
      if (decision.docCount !== null && current) tx.set(ref, { ...current, docCount: decision.docCount });
      if (decision.saveRecord === null) tx.delete(rec);
      if (decision.saveRecord) tx.set(rec, decision.saveRecord);
      return { status: decision.status, body: decision.body };
    });
  } catch {
    // Unknown provider work is not refunded from the admission counter: doing so would let a failing
    // query issue unbounded work. This is an operations allowance, never a wallet debit.
    return fail(503, 'The database could not complete this request. No extra wallet charge was made.');
  }
}
