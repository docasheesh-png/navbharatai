/**
 * G2 — Observability: persist daily MetricsSnapshot to Firestore.
 *
 * One document per calendar day (doc ID = 'YYYY-MM-DD'). Updated best-effort
 * after every build so metrics survive Cloud Run restarts and can be queried
 * historically. Never throws — if Firestore is unavailable the build is unaffected.
 *
 * Collection: `metrics_snapshots`
 */
import * as admin from 'firebase-admin';
import { getMetrics, type MetricsSnapshot } from './metrics';

export interface DailyMetricsDoc {
  date: string;
  snapshot: MetricsSnapshot;
  updatedAt: number;
}

class MetricsStore {
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

  async save(): Promise<void> {
    const db = this.getDb();
    if (!db) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const doc: DailyMetricsDoc = {
        date: today,
        snapshot: getMetrics().snapshot(),
        updatedAt: Date.now(),
      };
      await db.collection('metrics_snapshots').doc(today).set(doc, { merge: true });
    } catch { /* best-effort — never break the build */ }
  }

  async list(days = 30): Promise<DailyMetricsDoc[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const snap = await db.collection('metrics_snapshots')
        .where('date', '>=', since)
        .orderBy('date', 'desc')
        .limit(Math.min(days, 90))
        .get();
      return snap.docs.map(d => d.data() as DailyMetricsDoc);
    } catch {
      return [];
    }
  }
}

export const metricsStore = new MetricsStore();
