// AgentV3 — durable record of a workspace's live deployment (R5 §5.1).
//
// The deploy tool publishes the built app to a PERMANENT Firebase Hosting URL, but until now that
// URL was only emitted as a transient wire event — a reconnect/refresh lost it, so the user could
// not get their live link back. This store persists the latest deployment per workspace so the UI
// can show a durable "Live site" link that survives reconnects and new sessions.
//
// Collection: `agentv3_deployments`
// Doc ID:     `<workspaceId>` (one record per workspace — the latest deploy wins)
// Fields:     workspaceId, userId, url, fileCount, updatedAt
//
// Pattern mirrors UserCostStore: VITEST-skip (tests never touch Firestore), best-effort (never
// throws, never blocks a deploy), set+merge so a missing doc is created atomically.
import * as admin from 'firebase-admin';

export interface DeploymentRecord {
  workspaceId: string;
  userId: string;
  url: string;
  fileCount: number;
  updatedAt: number;
}

class DeploymentStore {
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

  /** Record (or update) the latest live deployment for a workspace. Best-effort. */
  async record(workspaceId: string, userId: string | null, url: string, fileCount: number): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !url) return;
    try {
      await db.collection('agentv3_deployments').doc(workspaceId).set(
        {
          workspaceId,
          userId: userId ?? 'anon',
          url,
          fileCount: Number.isFinite(fileCount) ? fileCount : 0,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    } catch { /* best-effort — never block a deploy */ }
  }

  /** Fetch the latest deployment for a workspace, or null if none / unavailable. */
  async get(workspaceId: string): Promise<DeploymentRecord | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_deployments').doc(workspaceId).get();
      if (!snap.exists) return null;
      return snap.data() as DeploymentRecord;
    } catch {
      return null;
    }
  }
}

export const deploymentStore = new DeploymentStore();

/**
 * Wrap a DeployFn so every successful deploy is also durably recorded (R5 §5.1). The returned
 * function has the SAME signature, so it is a drop-in for the dispatcher. Recording is best-effort
 * and never affects the deploy result or its URL.
 */
export function withDeploymentPersistence(
  base: (workspaceId: string, files: Map<string, Buffer>) => Promise<string>,
  userId: string | null,
): (workspaceId: string, files: Map<string, Buffer>) => Promise<string> {
  return async (workspaceId, files) => {
    const url = await base(workspaceId, files);
    void deploymentStore.record(workspaceId, userId, url, files.size);
    return url;
  };
}
