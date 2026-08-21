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
import { getServerDb } from '../lib/serverDb';
import { enforceHostingQuota, isFirstPartyProvider, deployBytesMb } from '../lib/HostingQuota';
import { hostingUsageStore } from '../lib/HostingUsageStore';
import { scanPublishedContent, publishScanBlocks } from './ContentSafetyScanner';
import { injectBadgeIntoFiles } from '../lib/madeWithBadge';
import { probeHostingPlan } from '../lib/hostingPlan';
import { audit } from '../lib/audit';

/** Lifecycle status of a published app (registry — enables takedown/report in later slices). */
/**
 * A deployment's registry state.
 *
 * ⚠️ 'unpublished' is SEPARATE from 'taken_down' on purpose (2026-08-21). A takedown is an admin
 * PUNISHMENT and the deploy gate refuses to ever republish it; an unpublish is the OWNER choosing to
 * remove their own app, and they must be able to publish it again whenever they like. Reusing
 * 'taken_down' for both would have locked users out of their own app for good — with a message about
 * a policy violation they never committed.
 *
 * Both are non-'active', so both correctly read as NOT live (isLiveDeployment) and both free the
 * user's slot in the hosting caps (liveAppCount / liveStorageMb skip anything not active).
 */
export type DeploymentStatus = 'active' | 'held' | 'taken_down' | 'unpublished';

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
  /** True when the content-safety scanner flagged this app in WARN mode (published, but surfaced). */
  flagged?: boolean;
  /**
   * The owner deleted the workspace while this app was still published (2026-08-21).
   *
   * The app is STILL LIVE — a link someone shared must not die because its author tidied their chat
   * list — but nobody can reach it from the app any more. Keeping the record marked is what stops it
   * becoming invisible to admin takedown, which is what deleting the record used to do.
   */
  orphaned?: boolean;
}

class DeploymentStore {
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

  /** Record (or update) the latest live deployment for a workspace. Best-effort. */
  async record(
    workspaceId: string,
    userId: string | null,
    url: string,
    fileCount: number,
    extra?: { providerId?: string; firstParty?: boolean; sizeMb?: number; status?: DeploymentStatus; flagged?: boolean },
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
          ...(typeof extra?.flagged === 'boolean' ? { flagged: extra.flagged } : {}),
          status: extra?.status ?? 'active',
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    } catch { /* best-effort — never block a deploy */ }
  }

  /**
   * Batch-fetch the latest deployments for a set of workspaces (doc ID = workspaceId, so this is
   * ONE `getAll` RPC, not N reads). Used by the history-list live-dot enrichment. Best-effort —
   * returns an empty map when Firestore is unavailable; never throws.
   */
  async getMany(workspaceIds: Array<string | undefined | null>): Promise<Map<string, DeploymentRecord>> {
    const out = new Map<string, DeploymentRecord>();
    const db = this.getDb();
    const ids = [...new Set(workspaceIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 100);
    if (!db || ids.length === 0) return out;
    try {
      const refs = ids.map((id) => db.collection('agentv3_deployments').doc(id));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) out.set(snap.id, snap.data() as DeploymentRecord);
      }
    } catch { /* best-effort — a store hiccup must never break the caller's list */ }
    return out;
  }

  /** GA-1 — delete a workspace's deployment record (so a deleted project leaves no orphaned deployment
   *  doc). Best-effort; never throws; no-op when Firestore is unavailable. */
  async delete(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_deployments').doc(workspaceId).delete();
    } catch { /* best-effort — a store hiccup must never break the caller */ }
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

  /**
   * List published deployments (admin registry). Best-effort; returns [] when unavailable. Orders by
   * updatedAt desc and filters `status` in memory so NO composite Firestore index is required.
   */
  async list(opts?: { status?: DeploymentStatus; limit?: number }): Promise<DeploymentRecord[]> {
    const db = this.getDb();
    if (!db) return [];
    const limit = Math.max(1, Math.min(500, opts?.limit ?? 100));
    try {
      const snap = await db.collection('agentv3_deployments').orderBy('updatedAt', 'desc').limit(limit).get();
      let recs = snap.docs.map((d) => d.data() as DeploymentRecord);
      if (opts?.status) recs = recs.filter((r) => (r.status ?? 'active') === opts.status);
      return recs;
    } catch {
      return [];
    }
  }

  /** List a single user's deployments (admin registry). Best-effort. */
  async listByUser(userId: string, limit = 100): Promise<DeploymentRecord[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    const cap = Math.max(1, Math.min(500, limit));
    try {
      const snap = await db.collection('agentv3_deployments').where('userId', '==', userId).limit(cap).get();
      return snap.docs
        .map((d) => d.data() as DeploymentRecord)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    } catch {
      return [];
    }
  }

  /** Set a deployment's registry status (takedown / hold / restore). Best-effort. Returns success. */
  /**
   * Mark a deployment as orphaned: its workspace was purged while the app was still published.
   *
   * Deliberately does NOT change `status` — the app really is still live, and saying otherwise would
   * be the fake status this file's own comments warn about. Best-effort; never throws.
   */
  async markOrphaned(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_deployments').doc(workspaceId)
        .set({ orphaned: true, updatedAt: Date.now() }, { merge: true });
    } catch { /* best-effort — a purge must never fail on this */ }
  }

  async setStatus(workspaceId: string, status: DeploymentStatus): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId) return false;
    try {
      await db.collection('agentv3_deployments').doc(workspaceId).set(
        { status, updatedAt: Date.now() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const deploymentStore = new DeploymentStore();

/**
 * True when a deployment record means the app is REALLY reachable at its URL right now:
 * it has a URL and its registry status is 'active' (not held for review, not taken down).
 * Pure — this is the single definition the history-menu "Live" dot keys off, so the dot can
 * never claim live for a held/taken-down/urlless record (no fake status, rule #2).
 */
export function isLiveDeployment(rec: Pick<DeploymentRecord, 'url' | 'status'> | null | undefined): boolean {
  return !!rec && typeof rec.url === 'string' && rec.url.length > 0 && (rec.status ?? 'active') === 'active';
}

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

    // TAKEDOWN re-publish guard: an app an admin took down for a policy violation must not be
    // silently re-published. Bounded (3s) + fail-OPEN — a store outage must never block a legit
    // deploy (blocking a taken-down republish during a rare outage is an acceptable trade vs rule #1).
    if (isFirstPartyProvider(providerId)) {
      const existing = await Promise.race([
        deploymentStore.get(workspaceId),
        new Promise<DeploymentRecord | null>((r) => setTimeout(() => r(null), 3_000)),
      ]).catch(() => null);
      if (existing?.status === 'taken_down') {
        throw new Error('This app was taken down for a policy violation and cannot be re-published. Contact support if you believe this is a mistake.');
      }
    }

    // CONTENT-SAFETY scan (Phase A): inspect the built page for phishing / wallet-drainer / brand-
    // impersonation signatures BEFORE it goes live. Pure + never throws. Default = WARN-ONLY (audit +
    // narration, publish proceeds) so a legit login for the user's own product is never wrongly
    // blocked; set AGENTV3_PUBLISH_SCAN=block to hard-block an unsafe verdict (marks status='held').
    let heldByScan = false;
    try {
      const scan = scanPublishedContent(files);
      if (!scan.safe) {
        audit('APP_PUBLISH_FLAGGED', { workspaceId, userId: userId ?? 'anon', findings: scan.findings.map((f) => `${f.severity}:${f.rule}`).join(',') });
        if (publishScanBlocks()) {
          void deploymentStore.setStatus(workspaceId, 'held');
          throw new Error(
            `This app was held for review: it looks like it may ${scan.findings[0]?.description || 'contain unsafe content'} ` +
            `Publishing is paused pending review. If this is a mistake (a legitimate login for your own product), contact support.`,
          );
        }
        heldByScan = true; // warn mode: record the flag on the registry, but still publish
      }
    } catch (err) {
      if (publishScanBlocks() && err instanceof Error && /held for review/.test(err.message)) throw err;
      /* warn-mode scan error is best-effort — never block a real publish */
    }

    // "MADE WITH NAVBHARATAI" BADGE (admin 2026-08-06): stamped HERE — at publish time, after every
    // source edit the user or any AI assistant could make — so removing it from the workspace files
    // is structurally futile (the next publish re-stamps it). Idempotent via its marker. This is the
    // ONE choke point every v5 publish provider flows through; do not move the stamp upstream into
    // user-editable source. Kill switch AGENTV3_MADE_WITH_BADGE=off.
    // The paid Custom Domain plan removes it: probe cached + bounded; an UNKNOWN answer keeps the
    // badge (a free user must not escape it during a store outage — the safe direction here).
    try {
      const plan = await probeHostingPlan(userId);
      injectBadgeIntoFiles(files, { paidRemoval: plan.known && plan.active });
    } catch { /* the badge must never break a publish */ }

    const url = await base(workspaceId, files);
    const firstParty = isFirstPartyProvider(providerId);
    // Count only platform-paid (first-party) publishes toward the free quota.
    if (firstParty) void hostingUsageStore.recordDeploy(userId);
    void deploymentStore.record(workspaceId, userId, url, files.size, {
      providerId: providerId ?? undefined,
      firstParty,
      sizeMb: Math.round(deployBytesMb(files) * 100) / 100,
      status: 'active',
      ...(heldByScan ? { flagged: true } : {}),
    });
    return url;
  };
}
