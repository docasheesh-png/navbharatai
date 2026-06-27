// AgentV3 — durable per-(workspace, provider) deploy state (R5 §5.1, multi-provider).
//
// Some providers (e.g. Netlify) need a STABLE target id (a site id) so that re-deploying a
// workspace updates the SAME site and keeps the same URL, instead of creating a new random site
// each time. This tiny store remembers that id per workspace+provider.
//
// Collection: `agentv3_provider_state`
// Doc ID:     `<workspaceId>__<provider>`
// Fields:     siteId, url, updatedAt
//
// Mirrors UserCostStore/DeploymentStore: VITEST-skip, best-effort, set+merge.
import * as admin from 'firebase-admin';

export interface ProviderState {
  siteId?: string;
  url?: string;
  updatedAt?: number;
}

class ProviderStateStore {
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

  private docId(workspaceId: string, provider: string): string {
    return `${workspaceId}__${provider}`;
  }

  async get(workspaceId: string, provider: string): Promise<ProviderState | null> {
    const db = this.getDb();
    if (!db || !workspaceId || !provider) return null;
    try {
      const snap = await db.collection('agentv3_provider_state').doc(this.docId(workspaceId, provider)).get();
      return snap.exists ? (snap.data() as ProviderState) : null;
    } catch {
      return null;
    }
  }

  async set(workspaceId: string, provider: string, state: ProviderState): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !provider) return;
    try {
      await db.collection('agentv3_provider_state').doc(this.docId(workspaceId, provider)).set(
        { ...state, updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort — never block a deploy */ }
  }
}

export const providerStateStore = new ProviderStateStore();
