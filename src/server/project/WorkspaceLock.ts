/**
 * Phase 4.1 — Distributed workspace lock: prevent two Cloud Run instances from
 * running concurrent builds on the same workspace, which causes race conditions
 * (partial writes, VFS corruption, double billing).
 *
 * Design:
 *  - One Firestore document per workspace: `workspace_locks/{workspaceId}`
 *  - Fields: `{ lockId, acquiredAt, expiresAt, instanceId }`
 *  - `tryAcquire()` uses a Firestore transaction to atomically check + write.
 *    Returns `{ acquired: true, lockId }` or `{ acquired: false, reason }`.
 *  - `release()` deletes the doc only if the lockId matches (safe release — a
 *    stale release from a crashed instance can't unlock a new owner's lock).
 *  - TTL auto-expires stale locks: any lock older than MAX_LOCK_TTL_MS is
 *    treated as expired and can be overwritten by the next caller.
 *
 * VITEST-skip + best-effort: a Firestore failure returns `{ acquired: true }`
 * (fail-open) — we'd rather have a rare race than block all builds when
 * Firestore is unreachable. The lock is an optimistic guard, not a hard mutex.
 *
 * Never throws.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import crypto from 'crypto';

/** Default lock TTL: 60 minutes. Stale locks older than this are auto-expired. */
const MAX_LOCK_TTL_MS = 60 * 60 * 1000;

interface LockDoc {
  lockId: string;
  acquiredAt: string;
  expiresAt: string;
  /** Cloud Run instance ID for debug — process.env.K_REVISION or 'local'. */
  instanceId: string;
}

export interface AcquireResult {
  acquired: boolean;
  lockId?: string;
  /** Populated when acquired:false — tells the caller why the lock is held. */
  reason?: string;
  /** Estimated time until current lock expires (ms). */
  expiresInMs?: number;
}

class WorkspaceLockStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /**
   * Attempt to acquire the lock for workspaceId.
   *
   * Fail-open: if Firestore is unavailable, returns `{ acquired: true }` with a
   * synthetic lockId so the build proceeds (a race is better than a full outage).
   */
  async tryAcquire(workspaceId: string, ttlMs = MAX_LOCK_TTL_MS): Promise<AcquireResult> {
    if (!workspaceId) return { acquired: true, lockId: 'noop' };
    const db = this.getDb();
    if (!db) {
      // VITEST or Firestore unavailable — fail-open so tests and dev work normally.
      return { acquired: true, lockId: `local-${Date.now()}` };
    }

    const ref = db.collection('workspace_locks').doc(workspaceId);
    const lockId = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const instanceId = process.env.K_REVISION || process.env.HOSTNAME || 'local';

    try {
      const result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const data = snap.data() as LockDoc;
          const lockedUntil = new Date(data.expiresAt).getTime();
          if (lockedUntil > now) {
            // Lock is still valid — reject
            return {
              acquired: false as const,
              reason: `Workspace is busy (another build is running, expires in ${Math.ceil((lockedUntil - now) / 1000)}s)`,
              expiresInMs: lockedUntil - now,
            };
          }
          // Stale lock (TTL expired) — overwrite it
          console.log(`[WORKSPACE_LOCK] Overwriting stale lock for ${workspaceId} (expired ${Math.ceil((now - lockedUntil) / 1000)}s ago)`);
        }
        // Write new lock
        tx.set(ref, { lockId, acquiredAt: new Date(now).toISOString(), expiresAt, instanceId });
        return { acquired: true as const, lockId };
      });
      return result;
    } catch (err: any) {
      // Firestore error — fail-open so the build can still proceed
      console.warn('[WORKSPACE_LOCK] Firestore error during acquire (fail-open):', err?.message);
      return { acquired: true, lockId: `fallback-${Date.now()}` };
    }
  }

  /**
   * Release the lock for workspaceId.
   * Only deletes the doc if the lockId matches — prevents a crashed instance
   * from releasing a lock it no longer owns. Best-effort, never throws.
   */
  async release(workspaceId: string, lockId: string): Promise<void> {
    if (!workspaceId || !lockId) return;
    const db = this.getDb();
    if (!db) return;
    try {
      const ref = db.collection('workspace_locks').doc(workspaceId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const data = snap.data() as LockDoc;
        // Only delete if we own the lock
        if (data.lockId === lockId) tx.delete(ref);
      });
    } catch (err: any) {
      console.warn('[WORKSPACE_LOCK] Firestore error during release (non-fatal):', err?.message);
    }
  }
}

export const workspaceLock = new WorkspaceLockStore();
