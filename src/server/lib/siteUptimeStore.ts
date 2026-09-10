/**
 * Where the uptime sweep remembers what it saw — `site_uptime/<domain>` (ROADMAP §13, 1.8).
 * HostingUsageStore pattern: VITEST-skip, best-effort, never throws. An unreadable record reads as
 * a fresh one, which can only DELAY an alert by one sweep, never invent one.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { emptyRecord, type UptimeRecord } from './siteUptime';

export const SITE_UPTIME_COLLECTION = 'site_uptime';

function docId(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/g, '_');
}

class SiteUptimeStore {
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

  async get(domain: string, workspaceId: string, userId: string): Promise<UptimeRecord> {
    const fresh = emptyRecord(domain, workspaceId, userId);
    const db = this.getDb();
    if (!db || !domain) return fresh;
    try {
      const snap = await db.collection(SITE_UPTIME_COLLECTION).doc(docId(domain)).get();
      if (!snap.exists) return fresh;
      const d = snap.data() as Partial<UptimeRecord>;
      return {
        ...fresh,
        failures: Number.isFinite(d.failures) ? Math.max(0, Math.floor(d.failures as number)) : 0,
        alerted: d.alerted === true,
        lastAlertAt: typeof d.lastAlertAt === 'number' ? d.lastAlertAt : null,
        lastOkAt: typeof d.lastOkAt === 'number' ? d.lastOkAt : null,
        lastCheckedAt: typeof d.lastCheckedAt === 'number' ? d.lastCheckedAt : null,
        lastOutcome: d.lastOutcome === 'up' || d.lastOutcome === 'down' || d.lastOutcome === 'unknown' ? d.lastOutcome : null,
      };
    } catch {
      return fresh;
    }
  }

  async set(rec: UptimeRecord): Promise<void> {
    const db = this.getDb();
    if (!db || !rec.domain) return;
    try {
      await db.collection(SITE_UPTIME_COLLECTION).doc(docId(rec.domain)).set({ ...rec, updatedAt: Date.now() }, { merge: true });
    } catch { /* best-effort — a missed write delays an alert by one sweep, never invents one */ }
  }
}

export const siteUptimeStore = new SiteUptimeStore();
