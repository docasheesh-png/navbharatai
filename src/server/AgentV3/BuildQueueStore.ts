// Durable queue coordination. Reads are authoritative; an unavailable store never acknowledges work.
import * as admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import { emptyQueue, serializeQueue, parseStoredQueue, claimNext, runningItem, validQueueContinuation, validQueueContinuationWindow, validQueueContinuationNonce, MAX_QUEUED_CONTINUATIONS, type CommandQueue, type QueueItem, type QueueContinuation } from './BuildQueue';
import { getServerDb } from '../lib/serverDb';
import { BoundedCache } from '../lib/boundedCache';
import { notePersistenceFailure } from '../lib/persistenceHealth';
import { leaseIsLive, WORKSPACE_BUILD_LEASE_COLLECTION, LEASE_STALE_MS, LEASE_CALL_TIMEOUT_MS } from './workspaceBuildLease';
import { QUEUED_PLAN_MODULE_MAX } from '../../lib/queueContinuation';

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
export interface QueueBuildExpectation {
  itemId?: string;
  claimToken?: string;
  continuationNonce?: string;
  predecessorAttemptId?: string;
  requestId?: string;
}
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
      || (item.claimedAt !== undefined && (typeof item.claimedAt !== 'number' || !Number.isFinite(item.claimedAt)))
      || (item.continuation !== undefined && (!validQueueContinuation(item.continuation) || item.status !== 'running'
        || !item.claimToken || item.continuation.predecessorAttemptId !== item.boundAttemptId))
      || (item.continuationWindow !== undefined && (!validQueueContinuationWindow(item.continuationWindow) || item.status !== 'running'
        || !item.claimToken || item.continuationWindow.attemptId !== item.boundAttemptId))) throw new QueueStoreUnavailableError();
  }
  const q = parseStoredQueue(workspaceId, raw);
  if (q.items.length !== raw.items.length || new Set(q.items.map((i) => i.id)).size !== q.items.length) throw new QueueStoreUnavailableError();
  return q;
}

function matchesBinding(item: QueueItem | undefined, binding: QueueBuildBinding): item is QueueItem {
  return !!item && item.status === 'running' && item.id === binding.itemId && item.claimToken === binding.claimToken && item.boundAttemptId === binding.attemptId;
}
function withoutContinuation(item: QueueItem): QueueItem {
  const next = { ...item };
  delete next.continuation;
  delete next.continuationWindow;
  return next;
}
function changeItem(queue: CommandQueue, item: QueueItem, replacement: QueueItem, paused = queue.paused): CommandQueue {
  return { ...queue, ...(paused ? { paused: true } : {}), items: queue.items.map((row) => row.id === item.id ? replacement : row) };
}

type LeaseChange = 'delete' | 'stop';
interface QueueMutation<R> { queue: CommandQueue; result: R; leaseChange?: LeaseChange; }

/** Independent store instances share only the database, never an admission cache. */
export function createBuildQueueStore(db: QueueDb | null) {
  const run = async <R>(workspaceId: string, op: (q: CommandQueue, lease: any) => QueueMutation<R>, withLease = false): Promise<{ queue: CommandQueue; result: R }> => {
    if (!db) throw new QueueStoreUnavailableError();
    try {
      const ref = db.collection(BUILD_QUEUE_COLLECTION).doc(workspaceId);
      return await queueDeadline(db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const leaseRef = withLease ? db.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(workspaceId) : null;
        const lease = withLease ? await tx.get(leaseRef) : null;
        const current = decode(workspaceId, snap.exists ? snap.data() : null);
        const leaseData = lease?.exists ? lease.data() : null;
        if (leaseData && (typeof leaseData.token !== 'string' || !leaseData.token || typeof leaseData.owner !== 'string'
          || typeof leaseData.heartbeatAt !== 'number' || !Number.isFinite(leaseData.heartbeatAt)
          || (leaseData.stopRequested !== undefined && typeof leaseData.stopRequested !== 'boolean'))) throw new QueueStoreUnavailableError();
        const out = op(current, leaseData);
        if (out.queue !== current) tx.set(ref, { workspaceId, queue: serializeQueue(out.queue), savedAt: Date.now(), version: 1 });
        if (out.leaseChange === 'delete') tx.delete(leaseRef);
        if (out.leaseChange === 'stop') tx.set(leaseRef, { ...leaseData, stopRequested: true });
        return { queue: out.queue, result: out.result }; // Only the final committed callback grants a result.
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
    bind(workspaceId: string, prompt: string, attemptId: string, expected?: QueueBuildExpectation) {
      const legacyToken = randomUUID();
      return run(workspaceId, (q, lease) => {
        const item = runningItem(q);
        if (expected?.continuationNonce !== undefined || expected?.predecessorAttemptId !== undefined) {
          const handoff = item?.continuation;
          if (!item || q.paused || prompt.trim() !== 'continue' || !expected.itemId || !expected.claimToken
            || expected.itemId !== item.id || expected.claimToken !== item.claimToken
            || !validQueueContinuationNonce(expected.continuationNonce) || handoff?.phase !== 'ready'
            || handoff.nonce !== expected.continuationNonce || handoff.predecessorAttemptId !== expected.predecessorAttemptId
            || item.boundAttemptId !== handoff.predecessorAttemptId || attemptId === handoff.predecessorAttemptId || !validQueueContinuationNonce(attemptId)
            || (expected.requestId !== undefined && !validQueueContinuationNonce(expected.requestId))
            || !leaseIsLive(lease, Date.now()) || lease.token !== attemptId || lease.stopRequested === true) throw new QueueClaimConflictError();
          const binding = { itemId: item.id, claimToken: item.claimToken!, attemptId };
          const identity = { version: handoff.version, nonce: handoff.nonce, predecessorAttemptId: handoff.predecessorAttemptId, planRemaining: handoff.planRemaining, ordinal: handoff.ordinal };
          const next = { ...item, boundAttemptId: attemptId, continuationWindow: { ...identity, attemptId,
            ...(expected.requestId ? { requestId: expected.requestId } : {}) } };
          delete next.continuation;
          return { queue: changeItem(q, item, next), result: binding };
        }
        // A new manual request cannot silently resume or overwrite an approved continuation gap.
        if (item?.continuation) throw new QueueClaimConflictError();
        if (!item || item.prompt !== prompt.trim()) {
          if (expected?.itemId || expected?.claimToken) throw new QueueClaimConflictError();
          return { queue: q, result: null as QueueBuildBinding | null };
        }
        if (!leaseIsLive(lease, Date.now()) || lease.token !== attemptId || lease.stopRequested === true) throw new QueueClaimConflictError();
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
        if (!matchesBinding(item, binding)) return { queue: q, result: false };
        const queue = changeItem(q, item, { ...withoutContinuation(item), status: ok ? 'done' : 'failed', ...(note ? { note: note.slice(0, 300) } : {}) }, !ok || q.paused);
        return { queue, result: true };
      });
    },
    proposeContinuation(workspaceId: string, binding: QueueBuildBinding, planRemaining: number, nonce = randomUUID()) {
      return run(workspaceId, (q, lease) => {
        const item = q.items.find((row) => row.id === binding.itemId);
        if (!matchesBinding(item, binding) || q.paused || !leaseIsLive(lease, Date.now()) || lease.token !== binding.attemptId
          || lease.stopRequested === true || !Number.isSafeInteger(planRemaining) || planRemaining <= 0 || planRemaining > QUEUED_PLAN_MODULE_MAX
          || !validQueueContinuationNonce(binding.attemptId) || !validQueueContinuationNonce(nonce)) throw new QueueClaimConflictError();
        if (item.continuation) {
          if (item.continuation.phase === 'pending' && item.continuation.predecessorAttemptId === binding.attemptId
            && item.continuation.planRemaining === planRemaining) return { queue: q, result: item.continuation };
          throw new QueueClaimConflictError();
        }
        const previous = item.continuationWindow;
        const ordinal = (previous?.ordinal ?? 0) + 1;
        if (ordinal > MAX_QUEUED_CONTINUATIONS || (previous && planRemaining >= previous.planRemaining)) throw new QueueClaimConflictError();
        const continuation: QueueContinuation = { version: 1, nonce, predecessorAttemptId: binding.attemptId, phase: 'pending', planRemaining, ordinal };
        return { queue: changeItem(q, item, { ...item, continuation }), result: continuation };
      }, true);
    },
    /** Only actual normal-body retirement may call this. Lease absence/age cannot manufacture READY. */
    retireContinuation(workspaceId: string, binding: QueueBuildBinding, nonce: string) {
      return run(workspaceId, (q, lease) => {
        const item = q.items.find((row) => row.id === binding.itemId);
        if (!matchesBinding(item, binding) || q.paused || item.continuation?.nonce !== nonce
          || item.continuation.predecessorAttemptId !== binding.attemptId) return { queue: q, result: false };
        if (item.continuation.phase === 'ready') return { queue: q, result: true };
        if (!leaseIsLive(lease, Date.now()) || lease.token !== binding.attemptId || lease.stopRequested === true) return { queue: q, result: false };
        return { queue: changeItem(q, item, { ...item, continuation: { ...item.continuation, phase: 'ready' } }), result: true, leaseChange: 'delete' as const };
      }, true);
    },
    cancelContinuation(workspaceId: string, binding: QueueBuildBinding, note = 'This queued step needs review before continuing.') {
      return run(workspaceId, (q) => {
        const item = q.items.find((row) => row.id === binding.itemId);
        if (!matchesBinding(item, binding)) return { queue: q, result: false };
        return { queue: changeItem(q, item, { ...withoutContinuation(item), status: 'failed', note: note.slice(0, 300) }, true), result: true };
      });
    },
    /** Stop and handoff transfer share both documents, so no idle or just-consumed window escapes. */
    stop(workspaceId: string, now = Date.now()) {
      return run(workspaceId, (q, lease) => {
        const leaseStopped = leaseIsLive(lease, now);
        const queuePaused = q.items.some((item) => item.status === 'pending' || item.status === 'running');
        const queue = queuePaused ? { ...q, paused: true, items: q.items.map((item) => item.status === 'running'
          ? { ...withoutContinuation(item), ...(item.continuation?.phase === 'ready' ? { status: 'failed' as const } : {}), note: 'Stopped. Review this queued step before continuing.' }
          : item) } : q;
        return { queue, result: { leaseStopped, queuePaused }, ...(leaseStopped ? { leaseChange: 'stop' as const } : {}) };
      }, true);
    },
    recover(workspaceId: string, itemId: string, now = Date.now()) {
      return run(workspaceId, (q, lease) => {
        const item = runningItem(q);
        // A brief gap between claim and /chat is normal. Recovery is explicit, identity-bound and atomic with the lease read.
        if (!item || item.id !== itemId || leaseIsLive(lease, now) || now - (item.claimedAt ?? item.createdTs) <= LEASE_STALE_MS) return { queue: q, result: false };
        return { queue: { ...q, paused: true, items: q.items.map((i) => i.id === itemId ? { ...withoutContinuation(i), status: 'failed' as const, note: 'Interrupted step. Review it before continuing the roadmap.' } : i) }, result: true };
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
  runTransaction: async (fn) => fn({ get: (ref: any) => ref.get(), set: (ref: any, data: any) => testDocs.set(ref.key, data), delete: (ref: any) => testDocs.delete(ref.key) }),
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
export const bindQueuedBuild = (workspaceId: string, prompt: string, attemptId: string, expected?: QueueBuildExpectation) => store().bind(workspaceId, prompt, attemptId, expected);
export const settleQueuedBuild = (workspaceId: string, binding: QueueBuildBinding, ok: boolean, note?: string) => store().settle(workspaceId, binding, ok, note);
export const proposeQueuedContinuation = (workspaceId: string, binding: QueueBuildBinding, planRemaining: number) => store().proposeContinuation(workspaceId, binding, planRemaining);
export const retireQueuedContinuation = (workspaceId: string, binding: QueueBuildBinding, nonce: string) => store().retireContinuation(workspaceId, binding, nonce);
export const cancelQueuedContinuation = (workspaceId: string, binding: QueueBuildBinding, note?: string) => store().cancelContinuation(workspaceId, binding, note);
export const stopWorkspaceQueueAndLease = (workspaceId: string) => store().stop(workspaceId);
export const recoverQueuedCommand = (workspaceId: string, itemId: string) => store().recover(workspaceId, itemId);
export const deleteQueue = (workspaceId: string) => store().delete(workspaceId);
