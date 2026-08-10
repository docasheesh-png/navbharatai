// AgentV3 — durable per-app command QUEUE persistence (FIX #4.2).
//
// The queue is the spine of the 3-role model: it must survive reloads, Cloud Run instance rotations,
// and days between sessions, and it is written CONCURRENTLY (the planner + advisor chats both enqueue
// while the executor drains). So mutations run in a Firestore TRANSACTION (read → apply the pure op →
// write) to avoid a lost update, and reads are strict (corrupt storage → an empty queue, never a
// half-queue). Mirrors ProjectPlanStore's firebase-admin/best-effort/VITEST-skip conventions.

import * as admin from 'firebase-admin';
import { emptyQueue, serializeQueue, parseStoredQueue, type CommandQueue } from './BuildQueue';
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';

const COLLECTION = 'build_queues_v3';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    // Collision-free shared admin handle (getFirestore(app, dbId)) — no per-store .settings() race.
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('build_queue', 'init', e);
    return null;
  }
}

interface CacheEntry { queue: CommandQueue; at: number; }
const cache = new Map<string, CacheEntry>();

function pruneCache(): void {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
}

/** Load a workspace's queue (cache → Firestore). Always returns a queue (empty when none). Never throws. */
export async function loadQueue(workspaceId: string): Promise<CommandQueue> {
  pruneCache();
  const hit = cache.get(workspaceId);
  if (hit) return hit.queue;
  const db = getDb();
  if (!db) return emptyQueue(workspaceId);
  try {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    const data = snap.exists ? snap.data() : null;
    const queue = data && typeof data.queue === 'string' ? parseStoredQueue(workspaceId, data.queue) : emptyQueue(workspaceId);
    cache.set(workspaceId, { queue, at: Date.now() });
    return queue;
  } catch {
    return emptyQueue(workspaceId); // do NOT cache a read failure
  }
}

/**
 * Apply a pure queue operation transactionally (read → op → write) so concurrent enqueues from the
 * planner/advisor chats can't lose an update. Falls back to load→apply→save when there's no db
 * (VITEST / outage) — single-instance in-process, still correct. Returns the resulting queue; the
 * in-process cache is always updated so the same instance stays consistent even through an outage.
 */
export async function mutateQueue(workspaceId: string, op: (q: CommandQueue) => CommandQueue): Promise<CommandQueue> {
  pruneCache();
  const db = getDb();
  if (!db) {
    const next = op(cache.get(workspaceId)?.queue ?? emptyQueue(workspaceId));
    cache.set(workspaceId, { queue: next, at: Date.now() });
    return next;
  }
  const ref = db.collection(COLLECTION).doc(workspaceId);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const current = data && typeof data.queue === 'string' ? parseStoredQueue(workspaceId, data.queue) : emptyQueue(workspaceId);
      const next = op(current);
      tx.set(ref, { workspaceId, queue: serializeQueue(next), savedAt: Date.now(), version: 1 }, { merge: false });
      return next;
    });
    cache.set(workspaceId, { queue: result, at: Date.now() });
    return result;
  } catch (e) {
    notePersistenceFailure('build_queue', 'write', e);
    // Best-effort fallback: apply in-process so the caller still gets a coherent result this instance.
    const next = op(cache.get(workspaceId)?.queue ?? emptyQueue(workspaceId));
    cache.set(workspaceId, { queue: next, at: Date.now() });
    return next;
  }
}

/** Remove a workspace's queue (project abandoned / reset). Never throws. */
export async function deleteQueue(workspaceId: string): Promise<void> {
  cache.delete(workspaceId);
  const db = getDb();
  if (!db) return;
  try { await db.collection(COLLECTION).doc(workspaceId).delete(); } catch (e) { notePersistenceFailure('build_queue', 'write', e); }
}

/** Test-only: reset the in-process cache between unit tests. */
export function __clearBuildQueueCacheForTests(): void {
  cache.clear();
}
