/**
 * AgentV3 — new-user free onboarding builds (P9, retention).
 *
 * Gives each NEW user their first N v5.0 builds free (N = AGENTV3_FREE_ONBOARDING_BUILDS,
 * default 0 = OFF). With the cost-ladder, a new user's first app (usually a simple one)
 * builds on Gemini for ~₹0 real cost, so the giveaway is near-free for NavBharatAI but a
 * strong first impression. DORMANT by default: when the limit is 0, nothing is waived and
 * billing is exactly as before.
 *
 * Tracks a LIFETIME per-user counter (not monthly) of free builds consumed. Fail-safe: any
 * Firestore error → returns false (the user is billed normally), so an outage can never make
 * every build accidentally free. Mirrors UserCostStore (VITEST-skip, best-effort, atomic).
 *
 * Collection: `agentv3_onboarding_credits`
 * Doc ID:     `{userId}`  → { userId, freeBuildsUsed, updatedAt }
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export interface OnboardingCreditDoc {
  userId: string;
  freeBuildsUsed: number;
  updatedAt: number;
}

/**
 * PURE eligibility policy: a build is free only when the feature is enabled (limit > 0) and
 * the user has used fewer than `limit` free builds. No I/O — unit-testable.
 */
export function onboardingEligible(freeBuildsUsed: number, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return (freeBuildsUsed ?? 0) < limit;
}

/** Parse the configured free-onboarding-build limit (AGENTV3_FREE_ONBOARDING_BUILDS, default 0). */
export function freeOnboardingLimit(): number {
  const raw = parseInt(process.env.AGENTV3_FREE_ONBOARDING_BUILDS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

class OnboardingCreditStore {
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
   * Atomically consume one free build IF the user is still eligible. Returns true when THIS
   * build should be free (and records the consumption), false otherwise. Fail-safe: any error
   * or missing DB → false (bill normally). Never throws.
   */
  async consumeFreeBuild(userId: string, limit: number): Promise<boolean> {
    if (!userId || userId === 'anon' || limit <= 0) return false;
    const db = this.getDb();
    if (!db) return false;
    try {
      const ref = db.collection('agentv3_onboarding_credits').doc(userId);
      return await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const used = snap.exists ? (snap.data() as OnboardingCreditDoc).freeBuildsUsed ?? 0 : 0;
        if (!onboardingEligible(used, limit)) return false;
        tx.set(ref, { userId, freeBuildsUsed: used + 1, updatedAt: Date.now() }, { merge: true });
        return true;
      });
    } catch {
      return false; // fail-safe: never make a build free on an error
    }
  }

  /** Read a user's free-build usage (display/debug). Best-effort. */
  async get(userId: string): Promise<OnboardingCreditDoc | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const snap = await db.collection('agentv3_onboarding_credits').doc(userId).get();
      return snap.exists ? (snap.data() as OnboardingCreditDoc) : null;
    } catch {
      return null;
    }
  }
}

export const onboardingCreditStore = new OnboardingCreditStore();
