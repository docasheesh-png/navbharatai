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

export interface SandboxRecord {
  workspaceId: string;
  userId: string;
  sandboxId: string;
  updatedAt: number;
}

class SandboxStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = admin.firestore();
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
