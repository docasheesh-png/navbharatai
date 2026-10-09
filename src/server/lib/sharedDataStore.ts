// Firestore adapter for the shared database. Admin SDK only — security rules deny this collection
// to every client. Callers pass the database in, so a test can pass a fake and production can pass
// getServerDb(). This file does not charge anyone.

import {
  SHARED_COLLECTION_RE, SHARED_DATA_MAX_LIST, SHARED_DATA_SHARDS, SHARED_DATA_START_LOCK_MS, SHARED_RECORD_ID_RE,
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

export interface SharedDb {
  collection(path: string): {
    doc(id: string): DocRef;
    limit(n: number): { get(): Promise<QuerySnap> };
    where(field: string, op: string, value: string): { limit(n: number): { get(): Promise<QuerySnap> } };
  };
  batch(): { delete(ref: DocRef): void; commit(): Promise<void> };
  runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

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
    docCount: typeof m.docCount === 'number' && Number.isFinite(m.docCount) ? m.docCount : 0,
  };
}

function asRecord(data: unknown): SharedRecord | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Partial<SharedRecord>;
  if (typeof r.collection !== 'string' || typeof r.id !== 'string' || !r.data || typeof r.data !== 'object') return null;
  return {
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
  op: 'list' | 'get' | 'create' | 'replace' | 'delete';
  collection: string;
  id: string | null;
  key: string;
  nowMs: number;
  data: Record<string, SharedScalar> | null;
}

function shardPick(): number {
  return Math.floor(Math.random() * SHARED_DATA_SHARDS);
}

export async function runSharedData(
  db: SharedDb,
  workspaceId: string,
  call: DataCall,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!SHARED_COLLECTION_RE.test(call.collection)) {
    return { status: 400, body: { ok: false, error: 'That collection name is not allowed. Nothing was changed.' } };
  }
  const id = call.op === 'create'
    ? (call.id && SHARED_RECORD_ID_RE.test(call.id) ? call.id : newRecordId())
    : call.id;
  let peeked: SharedMeta | null = null;
  try {
    const snap = await metaRef(db, workspaceId).get();
    peeked = snap.exists ? asMeta(snap.data()) : null;
  } catch {
    return { status: 503, body: { ok: false, error: 'The database could not be reached. Nothing was changed and nothing extra was charged.' } };
  }
  const gate = gateSharedCall(peeked, hashApiKey(call.key), call.nowMs);
  if (!gate.ok) return { status: gate.status, body: { ok: false, error: gate.error } };
  let listed: SharedRecord[] = [];
  if (call.op === 'list') {
    try {
      const snap = await db.collection(`nbai_app_data/${workspaceId}/records`)
        .where('collection', '==', call.collection)
        .limit(SHARED_DATA_MAX_LIST)
        .get();
      listed = snap.docs.map((d) => asRecord(d.data())).filter((r): r is SharedRecord => r !== null);
    } catch {
      return { status: 503, body: { ok: false, error: 'The database could not be read. Nothing was changed.' } };
    }
  }
  try {
    return await db.runTransaction(async (tx) => {
      const ref = metaRef(db, workspaceId);
      const metaSnap = await tx.get(ref);
      const meta = metaSnap.exists ? asMeta(metaSnap.data()) : null;
      const shardSnaps = await Promise.all(
        Array.from({ length: SHARED_DATA_SHARDS }, (_, i) => tx.get(shardRef(db, workspaceId, i))),
      );
      let opsCount = 0;
      const shardCounts: number[] = [];
      for (const snap of shardSnaps) {
        const raw = snap.exists ? snap.data() : undefined;
        const n = raw && typeof raw === 'object' && typeof (raw as { n?: unknown }).n === 'number'
          ? (raw as { n: number }).n
          : 0;
        shardCounts.push(Number.isFinite(n) ? n : 0);
        opsCount += Number.isFinite(n) ? n : 0;
      }
      let record: SharedRecord | null = null;
      let rec: DocRef | null = null;
      if (id && (call.op === 'get' || call.op === 'replace' || call.op === 'delete' || call.op === 'create')) {
        rec = recordRef(db, workspaceId, call.collection, id);
        const recSnap = await tx.get(rec);
        record = recSnap.exists ? asRecord(recSnap.data()) : null;
      }
      let data = call.data;
      if (call.op === 'replace' && record && data) data = { ...record.data, ...data };
      const decision: DecideResult = decideDataOp({
        meta,
        opsCount,
        nowMs: call.nowMs,
        keyHash: hashApiKey(call.key),
        op: call.op,
        collection: call.collection,
        id,
        record,
        listCount: call.op === 'list' ? listed.length : 0,
        data,
      });
      if (decision.opsAdd > 0 && meta) {
        const pick = shardPick();
        tx.set(shardRef(db, workspaceId, pick), { n: (shardCounts[pick] ?? 0) + decision.opsAdd }, { merge: true });
      }
      if (decision.docCount !== null && meta) {
        tx.set(ref, { ...meta, docCount: decision.docCount });
      }
      if (decision.saveRecord === null && rec) tx.delete(rec);
      if (decision.saveRecord) {
        const saved = decision.saveRecord;
        tx.set(recordRef(db, workspaceId, saved.collection, saved.id), saved);
      }
      const body = decision.body;
      if (decision.status === 200 && call.op === 'list') {
        body.records = listed.map((row) => ({ id: row.id, record: row.data }));
      }
      return { status: decision.status, body };
    });
  } catch {
    return { status: 503, body: { ok: false, error: 'The database could not be reached. Nothing was changed and nothing extra was charged.' } };
  }
}
