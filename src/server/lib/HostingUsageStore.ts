/**
 * Per-user monthly HOSTING (publish/deploy) usage — the counter behind the free-hosting quota.
 *
 * NavBharatAI pays for every FIRST-PARTY deploy (Firebase Hosting today, Cloudflare later). Until now
 * there was NO limit and NO record, so a single user could publish unlimited apps on the platform's
 * bill (an open cost/abuse hole). This store tracks how many first-party deploys a user made this
 * calendar month so HostingQuota can enforce a free-tier cap. BYO-token deploys (the user's own
 * GitHub Pages / Netlify / Vercel) are the user's own cost and are NOT counted here.
 *
 * Collection: `hosting_usage`
 * Doc ID:     `{userId}_{YYYY-MM}` (one doc per user per month)
 * Fields:     userId, month, deployCount, updatedAt
 *
 * Pattern mirrors UserCostStore VERBATIM: VITEST-skip (tests never touch Firestore), best-effort
 * (never throws, never blocks a deploy), transactional increment so concurrent deploys can't lose a
 * count. Kept a SEPARATE collection/doc from user_costs so it never clobbers the billing total.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export interface HostingUsageDoc {
  userId: string;
  month: string;
  deployCount: number;
  updatedAt: number;
}

class HostingUsageStore {
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

  private monthKey(): string {
    return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  }

  /** Increment the user's first-party deploy count for the current month. Best-effort. */
  async recordDeploy(userId: string | null | undefined): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;
    const month = this.monthKey();
    const docId = `${userId}_${month}`;
    try {
      const ref = db.collection('hosting_usage').doc(docId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? (snap.data() as HostingUsageDoc) : null;
        tx.set(ref, {
          userId,
          month,
          deployCount: (existing?.deployCount ?? 0) + 1,
          updatedAt: Date.now(),
        }, { merge: false });
      });
    } catch { /* best-effort — never block a deploy */ }
  }

  /** Fetch a user's monthly hosting usage. Defaults to the current month. */
  async get(userId: string, month?: string): Promise<HostingUsageDoc | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    const m = month ?? this.monthKey();
    try {
      const snap = await db.collection('hosting_usage').doc(`${userId}_${m}`).get();
      if (!snap.exists) return null;
      return snap.data() as HostingUsageDoc;
    } catch {
      return null;
    }
  }
}

export const hostingUsageStore = new HostingUsageStore();
