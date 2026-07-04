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
import { enforceHostingQuota, isFirstPartyProvider, deployBytesMb } from '../lib/HostingQuota';
import { hostingUsageStore } from '../lib/HostingUsageStore';

/** Lifecycle status of a published app (registry — enables takedown/report in later slices). */
export type DeploymentStatus = 'active' | 'held' | 'taken_down';

export interface DeploymentRecord {
  workspaceId: string;
  userId: string;
  url: string;
  fileCount: number;
  updatedAt: number;
  /** Hosting provider id (e.g. 'firebase'). Present on records written after the Phase 0 quota wiring. */
  providerId?: string;
  /** True when NavBharatAI paid for this deploy (first-party host). */
  firstParty?: boolean;
  /** Published bundle size in MB (2dp). */
  sizeMb?: number;
  /** Registry status; defaults to 'active'. */
  status?: DeploymentStatus;
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
  async record(
    workspaceId: string,
    userId: string | null,
    url: string,
    fileCount: number,
    extra?: { providerId?: string; firstParty?: boolean; sizeMb?: number; status?: DeploymentStatus },
  ): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !url) return;
    try {
      await db.collection('agentv3_deployments').doc(workspaceId).set(
        {
          workspaceId,
          userId: userId ?? 'anon',
          url,
          fileCount: Number.isFinite(fileCount) ? fileCount : 0,
          ...(extra?.providerId ? { providerId: extra.providerId } : {}),
          ...(typeof extra?.firstParty === 'boolean' ? { firstParty: extra.firstParty } : {}),
          ...(typeof extra?.sizeMb === 'number' ? { sizeMb: extra.sizeMb } : {}),
          status: extra?.status ?? 'active',
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
  providerId?: string | null,
): (workspaceId: string, files: Map<string, Buffer>) => Promise<string> {
  return async (workspaceId, files) => {
    // HOSTING QUOTA GATE (Phase 0): enforce the per-publish size ceiling + monthly free-deploy count
    // for FIRST-PARTY (platform-paid) deploys BEFORE publishing. Bounded to 5s and FAIL-OPEN — a
    // quota-store hang or error must NEVER wrongly block a legitimate deploy (rule #1). Over-limit
    // throws an honest Error that propagates to the deploy tool's error result (no `preview` event,
    // no URL, no fake success). BYO providers (user's own host/cost) pass straight through.
    const verdict = await Promise.race([
      enforceHostingQuota({ userId, workspaceId, providerId, files }),
      new Promise<{ allowed: boolean; message?: string }>((r) => setTimeout(() => r({ allowed: true }), 5_000)),
    ]).catch(() => ({ allowed: true as boolean, message: '' }));
    if (verdict && verdict.allowed === false) {
      throw new Error(('message' in verdict && verdict.message) ? verdict.message : 'Hosting limit reached.');
    }

    const url = await base(workspaceId, files);
    const firstParty = isFirstPartyProvider(providerId);
    // Count only platform-paid (first-party) publishes toward the free quota.
    if (firstParty) void hostingUsageStore.recordDeploy(userId);
    void deploymentStore.record(workspaceId, userId, url, files.size, {
      providerId: providerId ?? undefined,
      firstParty,
      sizeMb: Math.round(deployBytesMb(files) * 100) / 100,
      status: 'active',
    });
    return url;
  };
}
