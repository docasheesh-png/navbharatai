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
import { getServerDb } from './serverDb';
import { randomUUID } from 'crypto';
import { listEqNewestFirst, type EqFilter } from './firestoreIndexSafe';

/**
 * Documents read for one log query before filtering and sorting in memory.
 *
 * Higher than the default index-safe cap because `server_logs` is the one collection here that
 * genuinely grows per EVENT rather than per user or per app — a narrow filter still has to reach
 * far enough back to find matches worth reading.
 */
const LOG_FETCH_CAP = 500;

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

/**
 * Return a shallow copy with all `undefined`-valued keys removed. firebase-admin's Firestore
 * rejects `undefined` field values with a SYNCHRONOUS throw from `.set()` (it happens before
 * the promise exists, so a trailing `.catch()` cannot swallow it). Stripping undefined keys
 * before the write keeps optional fields (traceId, message, …) safe to omit. Pure + exported
 * for unit testing.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}

class LogStore {
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

  append(entry: Omit<LogEntry, 'id' | 'ts'>): void {
    // The whole body is guarded: firebase-admin's `.set()` validates SYNCHRONOUSLY and throws
    // (before returning a promise) on an `undefined` field value — so a trailing `.catch()`
    // cannot catch it. Without this guard a single optional field left undefined (e.g. traceId
    // on an audit entry) would throw straight through `audit()` into the request handler and
    // turn an intended 403 into a 500. We both strip undefined values and wrap in try/catch to
    // honour this module's documented "never throws" contract.
    try {
      const db = this.getDb();
      if (!db) return;
      const doc = stripUndefined({ id: randomUUID(), ts: Date.now(), ...entry }) as LogEntry;
      // Fire-and-forget — never await; the reject handler catches async write failures.
      db.collection('server_logs').doc(doc.id).set(doc).catch(() => {});
    } catch {
      // Persistence is best-effort; the stdout audit line is the durable record.
    }
  }

  /**
   * Query the durable log.
   *
   * Equality filters go to Firestore (a conjunction of equality filters is served by merging the
   * automatic single-field indexes, so it needs nothing deployed); the `ts` range and the
   * newest-first ordering are applied in memory. The previous version chained `.orderBy('ts')` onto
   * those filters, which is a composite-index query — and this project has no deployed composite
   * indexes. It threw, the `catch` returned `[]`, and the admin log viewer reported "no logs match"
   * for every filtered search. An empty result is indistinguishable from a working search that
   * found nothing, which is why this went unnoticed: the failure looked like an answer.
   */
  async query({ level, event, workspaceId, since, limit = 100 }: LogQuery = {}): Promise<LogEntry[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const filters: EqFilter[] = [];
      if (level) filters.push(['level', level]);
      if (event) filters.push(['event', event]);
      if (workspaceId) filters.push(['workspaceId', workspaceId]);
      const rows = await listEqNewestFirst<LogEntry>(
        db.collection('server_logs'), filters, 'ts', LOG_FETCH_CAP, LOG_FETCH_CAP,
      );
      const inRange = since ? rows.filter((r) => (r.ts ?? 0) >= since) : rows;
      return inRange.slice(0, Math.min(limit, 500));
    } catch {
      return [];
    }
  }
}

export const logStore = new LogStore();
