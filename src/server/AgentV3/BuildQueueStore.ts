// Durable queue coordination. Reads are authoritative; an unavailable store never acknowledges work.
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { emptyQueue, serializeQueue, parseStoredQueue, claimNext, runningItem, type CommandQueue, type QueueItem } from './BuildQueue';
import { getServerDb } from '../lib/serverDb';
import { BoundedCache } from '../lib/boundedCache';
import { notePersistenceFailure } from '../lib/persistenceHealth';
import { leaseIsLive, WORKSPACE_BUILD_LEASE_COLLECTION, LEASE_STALE_MS, LEASE_CALL_TIMEOUT_MS } from './workspaceBuildLease';

export const BUILD_QUEUE_COLLECTION = 'build_queues_v3';
export const BUILD_QUEUE_CALL_TIMEOUT_MS = LEASE_CALL_TIMEOUT_MS;

// A timed-out call has an unknown durable outcome. Late completion never becomes a fake success.
async function queueDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new QueueStoreUnavailableError()), BUILD_QUEUE_CALL_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export class QueueStoreUnavailableError extends Error {
  readonly code = 'QUEUE_STORE_UNAVAILABLE';
  constructor() { super('Your queue could not be confirmed. Please retry shortly.'); }
}
export class QueueClaimConflictError extends Error {
  readonly code = 'QUEUE_CLAIM_CONFLICT';
  constructor() { super('This queued step is already attached to another build. Refresh the queue before retrying.'); }
}
export interface QueueBuildBinding { itemId: string; claimToken: string; attemptId: string; }
export interface QueueDb {
  collection(name: string): { doc(id: string): any };
  runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

function decode(workspaceId: string, data: any): CommandQueue {
  if (!data) return emptyQueue(workspaceId);
  let raw: any;
  try { raw = JSON.parse(data.queue); } catch { throw new QueueStoreUnavailableError(); }
  if (raw?.workspaceId !== workspaceId || (raw.paused !== undefined && typeof raw.paused !== 'boolean') || !Array.isArray(raw?.items)) throw new QueueStoreUnavailableError();
  for (const item of raw.items) {
    if (!item || (item.claimToken !== undefined && (typeof item.claimToken !== 'string' || !item.claimToken))
      || (item.boundAttemptId !== undefined && (typeof item.boundAttemptId !== 'string' || !item.boundAttemptId))
      || (item.claimedAt !== undefined && (typeof item.claimedAt !== 'number' || !Number.isFinite(item.claimedAt)))) throw new QueueStoreUnavailableError();
  }
  const q = parseStoredQueue(workspaceId, raw);
  if (q.items.length !== raw.items.length || new Set(q.items.map((i) => i.id)).size !== q.items.length) throw new QueueStoreUnavailableError();
  return q;
}

/** Independent store instances share only the database, never an admission cache. */
export function createBuildQueueStore(db: QueueDb | null) {
  const run = async <R>(workspaceId: string, op: (q: CommandQueue, lease: any) => { queue: CommandQueue; result: R }, withLease = false): Promise<{ queue: CommandQueue; result: R }> => {
    if (!db) throw new QueueStoreUnavailableError();
    try {
      const ref = db.collection(BUILD_QUEUE_COLLECTION).doc(workspaceId);
      return await queueDeadline(db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const lease = withLease ? await tx.get(db.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(workspaceId)) : null;
        const current = decode(workspaceId, snap.exists ? snap.data() : null);
        const leaseData = lease?.exists ? lease.data() : null;
        if (leaseData && (typeof leaseData.token !== 'string' || !leaseData.token || typeof leaseData.owner !== 'string'
          || typeof leaseData.heartbeatAt !== 'number' || !Number.isFinite(leaseData.heartbeatAt))) throw new QueueStoreUnavailableError();
        const out = op(current, leaseData);
        if (out.queue !== current) tx.set(ref, { workspaceId, queue: serializeQueue(out.queue), savedAt: Date.now(), version: 1 });
        return out; // Return the committed callback's result, never a closure mutated by a retried callback.
      }));
    } catch (e) {
      if (e instanceof QueueClaimConflictError) throw e;
      notePersistenceFailure('build_queue', 'write', e);
      throw new QueueStoreUnavailableError();
    }
  };
  return {
    async load(workspaceId: string): Promise<CommandQueue> {
      if (!db) throw new QueueStoreUnavailableError();
      try {
        const snap: any = await queueDeadline(db.collection(BUILD_QUEUE_COLLECTION).doc(workspaceId).get());
        return decode(workspaceId, snap.exists ? snap.data() : null);
      } catch (e) { notePersistenceFailure('build_queue', 'read', e); throw new QueueStoreUnavailableError(); }
    },
    mutate<R>(workspaceId: string, op: (q: CommandQueue) => { queue: CommandQueue; result: R }) { return run(workspaceId, op); },
    claim(workspaceId: string, token = randomUUID(), now = Date.now(), resumeAfterFailure = false) {
      return run(workspaceId, (q, lease) => {
        if (leaseIsLive(lease, now)) return { queue: q, result: null as QueueItem | null };
        const next = claimNext(resumeAfterFailure && q.paused ? { ...q, paused: false } : q, { token, at: now });
        return { queue: next.queue, result: next.claimed };
      }, true);
    },
    bind(workspaceId: string, prompt: string, attemptId: string, expected?: { itemId?: string; claimToken?: string }) {
      const legacyToken = randomUUID();
      return run(workspaceId, (q, lease) => {
        const item = runningItem(q);
        if (!item || item.prompt !== prompt.trim()) {
          if (expected?.itemId || expected?.claimToken) throw new QueueClaimConflictError();
          return { queue: q, result: null as QueueBuildBinding | null };
        }
        if (!leaseIsLive(lease, Date.now()) || lease.token !== attemptId) throw new QueueClaimConflictError();
        if ((expected?.itemId && expected.itemId !== item.id) || (expected?.claimToken && expected.claimToken !== item.claimToken)
          || (item.boundAttemptId && item.boundAttemptId !== attemptId)) throw new QueueClaimConflictError();
        const binding = { itemId: item.id, claimToken: item.claimToken || legacyToken, attemptId };
        const queue = { ...q, items: q.items.map((i) => i.id === item.id ? { ...i, claimToken: binding.claimToken, claimedAt: i.claimedAt ?? Date.now(), boundAttemptId: attemptId } : i) };
        return { queue, result: binding };
      }, true);
    },
    settle(workspaceId: string, binding: QueueBuildBinding, ok: boolean, note?: string) {
      return run(workspaceId, (q) => {
        const item = q.items.find((i) => i.id === binding.itemId);
        if (!item || item.status !== 'running' || item.claimToken !== binding.claimToken || item.boundAttemptId !== binding.attemptId) return { queue: q, result: false };
        const queue = { ...q, ...(!ok ? { paused: true } : {}), items: q.items.map((i) => i.id === item.id ? { ...i, status: ok ? 'done' as const : 'failed' as const, ...(note ? { note: note.slice(0, 300) } : {}) } : i) };
        return { queue, result: true };
      });
    },
    recover(workspaceId: string, itemId: string, now = Date.now()) {
      return run(workspaceId, (q, lease) => {
        const item = runningItem(q);
        // A brief gap between claim and /chat is normal. Recovery is explicit, identity-bound and atomic with the lease read.
        if (!item || item.id !== itemId || leaseIsLive(lease, now) || now - (item.claimedAt ?? item.createdTs) <= LEASE_STALE_MS) return { queue: q, result: false };
        return { queue: { ...q, paused: true, items: q.items.map((i) => i.id === itemId ? { ...i, status: 'failed' as const, note: 'Interrupted step. Review it before continuing the roadmap.' } : i) }, result: true };
      }, true);
    },
    async delete(workspaceId: string) {
      if (!db) throw new QueueStoreUnavailableError();
      try { await queueDeadline(db.collection(BUILD_QUEUE_COLLECTION).doc(workspaceId).delete()); }
      catch (e) { notePersistenceFailure('build_queue', 'write', e); throw new QueueStoreUnavailableError(); }
    },
  };
}

let injected: QueueDb | null | undefined;
// Legacy unit tests retain an explicit test-only backend; production has no in-memory fallback.
const testDocs = new BoundedCache<string, any>({ maxEntries: 2000 });
const testDb: QueueDb = {
  collection: (name) => ({ doc: (id) => {
    const key = `${name}/${id}`;
    return { key, get: async () => ({ exists: testDocs.has(key), data: () => testDocs.get(key) }), delete: async () => { testDocs.delete(key); } };
  } }),
  runTransaction: async (fn) => fn({ get: (ref: any) => ref.get(), set: (ref: any, data: any) => testDocs.set(ref.key, data) }),
};
function store() {
  const db = injected !== undefined ? injected : process.env.VITEST ? testDb : getServerDb();
  return createBuildQueueStore(db as admin.firestore.Firestore | null);
}
export function __bindBuildQueueDbForTests(db: QueueDb | null | undefined): void { injected = db; }
export function __clearBuildQueueCacheForTests(): void { testDocs.clear(); injected = undefined; }
export const loadQueue = (workspaceId: string) => store().load(workspaceId);
export const mutateQueueWithResult = <R>(workspaceId: string, op: (q: CommandQueue) => { queue: CommandQueue; result: R }) => store().mutate(workspaceId, op);
export const mutateQueue = async (workspaceId: string, op: (q: CommandQueue) => CommandQueue) => (await store().mutate(workspaceId, (q) => ({ queue: op(q), result: null }))).queue;
export const claimQueuedCommand = (workspaceId: string, resumeAfterFailure = false) => store().claim(workspaceId, undefined, undefined, resumeAfterFailure);
export const bindQueuedBuild = (workspaceId: string, prompt: string, attemptId: string, expected?: { itemId?: string; claimToken?: string }) => store().bind(workspaceId, prompt, attemptId, expected);
export const settleQueuedBuild = (workspaceId: string, binding: QueueBuildBinding, ok: boolean, note?: string) => store().settle(workspaceId, binding, ok, note);
export const recoverQueuedCommand = (workspaceId: string, itemId: string) => store().recover(workspaceId, itemId);
export const deleteQueue = (workspaceId: string) => store().delete(workspaceId);
