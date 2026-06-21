/**
 * G2 — Observability: persist structured log entries to Firestore.
 *
 * Entries are written best-effort (fire-and-forget) alongside the existing
 * stdout console.log — adding persistence without removing the log trail.
 * Never throws. Gracefully degrades if Firestore is unavailable.
 *
 * Collection: `server_logs`
 */
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';

export interface LogEntry {
  id: string;
  ts: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  traceId?: string;
  workspaceId?: string;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  level?: 'info' | 'warn' | 'error';
  event?: string;
  workspaceId?: string;
  since?: number;
  limit?: number;
}

class LogStore {
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

  append(entry: Omit<LogEntry, 'id' | 'ts'>): void {
    const db = this.getDb();
    if (!db) return;
    const doc: LogEntry = { id: randomUUID(), ts: Date.now(), ...entry };
    // Fire-and-forget — never await, never throw
    db.collection('server_logs').doc(doc.id).set(doc).catch(() => {});
  }

  async query({ level, event, workspaceId, since, limit = 100 }: LogQuery = {}): Promise<LogEntry[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      let q: admin.firestore.Query = db.collection('server_logs').orderBy('ts', 'desc');
      if (since) q = q.where('ts', '>=', since);
      if (level) q = q.where('level', '==', level);
      if (event) q = q.where('event', '==', event);
      if (workspaceId) q = q.where('workspaceId', '==', workspaceId);
      const snap = await q.limit(Math.min(limit, 500)).get();
      return snap.docs.map(d => d.data() as LogEntry);
    } catch {
      return [];
    }
  }
}

export const logStore = new LogStore();
