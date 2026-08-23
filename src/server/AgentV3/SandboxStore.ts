// AgentV3 — durable record of a workspace's E2B sandbox id, so a RETURNING build can RESUME the same
// warm sandbox (files + node_modules + dev server already there) instead of paying a full cold
// create + restore + npm install on every turn.
//
// The E2BActuator already supports resume: getSandbox() calls Sandbox.connect(resumeSandboxId) with an
// auto-create fallback, and the idle sweep pauses inactive sandboxes (E2B persists a paused sandbox).
// The only missing piece was persisting the sandbox id across a Cloud Run instance restart. This store
// closes that gap.
//
// Collection: `agentv3_sandboxes`
// Doc ID:     `<workspaceId>` (one sandbox per workspace — the latest wins)
// Fields:     workspaceId, userId, sandboxId, updatedAt
//
// SAFETY — "a user only ever resumes their OWN sandbox":
//   The doc is keyed by workspaceId, and workspaceId is `agentv3-{uid}-{sessionId}` derived SERVER-SIDE
//   from the VERIFIED Firebase identity (deriveWorkspaceId). A caller can never produce a workspaceId
//   for a uid that isn't theirs, so get(workspaceId) can only ever return THIS user's sandbox. Combined
//   with the single-build-per-account lock (activeBuilds 409), two instances never resume the same
//   sandbox concurrently. Mirrors DeploymentStore: VITEST-skip, best-effort, never throws/blocks a build.
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { isUsableRecipe, type PreviewRecipe } from './previewRevival';

export interface SandboxRecord {
  workspaceId: string;
  userId: string;
  sandboxId: string;
  updatedAt: number;
  /** Epoch ms the orphan reaper paused this sandbox, if it ever did. See sandboxReaper.ts. */
  pausedAt?: number;
  /**
   * How to bring this preview back WITHOUT guessing — the command that actually started the dev
   * server and the port that actually rendered the app, captured the moment the preview first worked.
   *
   * It lives on THIS record, not in a second collection, on purpose: it shares the workspace's
   * lifetime exactly, it is read at precisely the moment a resume is being attempted, and one record
   * cannot drift out of step with itself. See previewRevival.ts for why it is captured at success
   * rather than derived at revival.
   */
  recipe?: PreviewRecipe;
}

class SandboxStore {
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

  /** Record (or update) the sandbox id for a workspace so the next build can resume it. Best-effort. */
  async record(workspaceId: string, userId: string | null, sandboxId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !sandboxId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, userId: userId ?? 'anon', sandboxId, updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort — never block a build */ }
  }

  /** Fetch the last known sandbox id for a workspace, or null if none / unavailable. */
  async get(workspaceId: string): Promise<string | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      const rec = snap.data() as SandboxRecord;
      return typeof rec?.sandboxId === 'string' && rec.sandboxId ? rec.sandboxId : null;
    } catch {
      return null;
    }
  }

  /**
   * The whole record for a workspace, or null.
   *
   * Exists for the CROSS-INSTANCE keep-alive. Cloud Run runs several instances; a keep-alive ping from
   * a user's popped-out preview tab can land on any of them, while the idle sweep that would pause
   * that sandbox runs on whichever instance happens to hold it. An in-memory stamp on the wrong
   * instance protects nothing, so the ping writes the DURABLE record and the sweep reads it here
   * before pausing anything. Best-effort — a read failure yields null and today's behaviour.
   */
  async getRecord(workspaceId: string): Promise<SandboxRecord | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      return (snap.data() as SandboxRecord) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Store the revival recipe proven by a successful boot, and CONFIRM it by reading it back.
   *
   * The read-back is the whole point. "We wrote it" and "it is there" are different facts, and a
   * guarantee that was never verified is not a guarantee — it is a hope that shows up as a broken
   * preview days later, when the user can do nothing about it. Verifying here, while the app is still
   * running, is what makes the promise answerable at the only moment it can still be fixed.
   *
   * Returns whether the recipe is genuinely retrievable. Never throws — a storage failure is reported
   * as `false` and surfaced honestly by the caller, never swallowed into a false promise.
   */
  async saveRecipe(workspaceId: string, recipe: PreviewRecipe): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !isUsableRecipe(recipe)) return false;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, recipe, updatedAt: Date.now() },
        { merge: true },
      );
      // CONFIRM — the round trip, not the write, is the guarantee.
      return isUsableRecipe(await this.getRecipe(workspaceId));
    } catch {
      return false;
    }
  }

  /** The stored revival recipe, or null when there is none / it is unusable. */
  async getRecipe(workspaceId: string): Promise<PreviewRecipe | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      const rec = (snap.data() as SandboxRecord)?.recipe;
      return isUsableRecipe(rec) ? rec : null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh `updatedAt` for a workspace whose sandbox is being used RIGHT NOW, without touching the
   * rest of the record. This is what makes the timestamp mean "last activity" rather than "last build
   * finished" — the orphan reaper reads it to tell a running build apart from an abandoned VM. The
   * caller throttles (shouldTouchDurable), so this is roughly one write per build per few minutes.
   */
  async touch(workspaceId: string, sandboxId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !sandboxId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, sandboxId, updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort — never block a build */ }
  }

  /**
   * The sandboxes whose last activity predates `cutoffMs` — candidates for the orphan reaper.
   *
   * Reads the DURABLE record rather than any one instance's memory, which is the entire point: a
   * sandbox created by a Cloud Run instance that has since been recycled is invisible to that
   * instance's idle sweep, but it is still right here. Bounded by `limit` so one sweep can never turn
   * into an unbounded read.
   */
  async listStale(cutoffMs: number, limit = 50): Promise<SandboxRecord[]> {
    const db = this.getDb();
    if (!db || !Number.isFinite(cutoffMs)) return [];
    try {
      const snap = await db.collection('agentv3_sandboxes')
        .where('updatedAt', '<', cutoffMs)
        .orderBy('updatedAt', 'asc')
        .limit(Math.max(1, Math.min(500, limit)))
        .get();
      return snap.docs.map((d) => d.data() as SandboxRecord).filter((r) => r && r.sandboxId);
    } catch {
      return []; // a missing index or a Firestore blip must never break the sweep
    }
  }

  /**
   * Note that the reaper paused this sandbox. The record is KEPT, not deleted — the sandbox still
   * exists and a returning user resumes it by id; only the compute is stopped. The stamp is what
   * keeps the next sweep from trying to pause it again every two minutes forever.
   */
  async markPaused(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { pausedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort */ }
  }

  /**
   * The most recently active sandbox records, newest first — the durable half of the Phase 0 handover
   * measurement (sandboxHandover.ts), which needs to know when each sandbox was last used and when a
   * pause path stopped it.
   *
   * ADMIN-ONLY and read-only: it feeds one admin card and touches nothing. Ordered by `updatedAt`,
   * which `listStale` above already orders by, so it reuses that single-field index and can never
   * FAILED_PRECONDITION on a missing composite one. Bounded like every other read here. Never throws.
   */
  async listRecent(limit = 200): Promise<SandboxRecord[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await db.collection('agentv3_sandboxes')
        .orderBy('updatedAt', 'desc')
        .limit(Math.max(1, Math.min(500, limit)))
        .get();
      return snap.docs.map((d) => d.data() as SandboxRecord).filter((r) => r && r.workspaceId);
    } catch {
      return [];
    }
  }

  /** Forget a workspace's sandbox (e.g. after a connect that failed because it was reaped). Best-effort. */
  async clear(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).delete();
    } catch { /* best-effort */ }
  }
}

export const sandboxStore = new SandboxStore();

/**
 * Feature flag — warm sandbox RESUME (A3). ON by default (admin 2026-07-03): with min-instances=0 the
 * in-process sandbox cache is wiped on every cold start, so the cross-instance resume (reconnect to the
 * user's OWN paused sandbox via SandboxStore + Sandbox.connect) is what actually keeps node_modules +
 * a warm dev server across turns → instant edits instead of a cold rebuild.
 *
 * SAFE to default on: the resume id is keyed by workspaceId (`agentv3-{uid}-{sessionId}`), so a user
 * can only ever reconnect to their OWN sandbox — never another user's. And E2BActuator wraps
 * Sandbox.connect in a try/catch that falls back to a fresh Sandbox.create if the target was
 * killed/expired, so the worst case is byte-identical to today (a fresh sandbox). Disable with
 * AGENTV3_SANDBOX_RESUME=off for an instant rollback.
 */
export function sandboxResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_SANDBOX_RESUME !== 'off';
}
