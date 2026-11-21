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

/**
 * 🔴 WHY THIS FILE NO LONGER USES `listEqNewestFirst` (Firestore bill audit, 2026-11-21).
 *
 * `server_logs` cost 71% of the whole Firestore bill: 8,160 runs in 30 days and ~4.5 crore document reads,
 * i.e. ~5,500 reads per run. The runs were `GET /api/warm` (Cloud Scheduler, every 5 minutes, step
 * `firestore:logStore` asking for ONE line) and the admin Monitor's log panel (`/api/admin/logs?limit=40`,
 * every 30 s while open). Both called `query()` with NO filter, which went to `listEqNewestFirst(…, [],
 * 'ts', …)`: an unfiltered `.limit(500)` always comes back FULL on a collection of millions, and a full
 * first page makes that helper read EVERY match in document-id order up to its 5,000 ceiling — 500 + 10 ×
 * 500 reads to return one row. The helper is right for its job (a per-user filter matching a few hundred
 * documents); it is wrong for a collection that grows per EVENT, where "every match" is the whole
 * collection.
 *
 * The rule now: a log read costs what it returns. Newest-first is `orderBy('ts', 'desc').limit(n)` —
 * served by the automatic single-field index on `ts`, so it needs no composite index (the reason the old
 * code sorted in memory). A filtered search walks the newest lines a page at a time and stops at `n`
 * matches or at LOG_FILTER_SCAN_BUDGET reads, and says whether it reached the end. Nothing here can read
 * the whole collection. `tests/serverLogsReadBudget.test.ts` locks both.
 */

/** Rows a log read returns when the caller names no limit — the admin panel's page size. */
export const LOG_DEFAULT_LIMIT = 50;
/** The most rows one log read will ever return. */
export const LOG_MAX_LIMIT = 500;
/** Page size for a filtered search's walk over the newest lines. */
export const LOG_SCAN_PAGE = 250;
/**
 * The most documents a FILTERED search may read. Past it the search stops and reports `complete: false`,
 * so "no match" is never claimed about lines it did not read.
 */
export const LOG_FILTER_SCAN_BUDGET = 2_000;

/**
 * Days a log line lives. The SAME number as the `server_logs` entry in DataRetentionManager's policy list
 * (the test reads both), so the TTL field and the purge can never disagree.
 */
export const LOG_RETENTION_DAYS = 30;
/**
 * The Timestamp field a Firestore TTL policy deletes on. TTL only acts on a Timestamp/Date field — `ts` is
 * an epoch NUMBER, which a TTL policy silently ignores — so each line also carries this.
 *
 * ⚠️ THE FIELD ALONE DELETES NOTHING. A TTL policy is a database setting, made once from a
 * gcloud-authenticated terminal (no Claude session can):
 *   gcloud firestore fields ttls update expireAt --collection-group=server_logs --enable-ttl \
 *     --database=<the server's Firestore database id> --project=gen-lang-client-0866594388
 * Until then the daily retention purge (DataRetentionManager, `where('ts', '<', cutoff)`, which reads only
 * expired lines) stays the mechanism, exactly as before. `guest_daily_usage` once wrote an `expireAt` with
 * no policy behind it and called it a deletion — this comment exists so this one is not mistaken for one.
 */
export const LOG_TTL_FIELD = 'expireAt';

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

/** A log read's answer, with how far it looked — so an empty filtered result is never mistaken for "none exist". */
export interface LogPage {
  entries: LogEntry[];
  /** Documents read to produce `entries`. */
  scanned: number;
  /**
   * True when the read reached every line it could match (or found `limit` of them). False only when a
   * filtered search hit LOG_FILTER_SCAN_BUDGET first: older matching lines may exist.
   */
  complete: boolean;
}

/** Clamp a requested row count into [1, LOG_MAX_LIMIT], defaulting to LOG_DEFAULT_LIMIT. PURE. */
export function logLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : LOG_DEFAULT_LIMIT;
  return Math.min(LOG_MAX_LIMIT, Math.max(1, n));
}

/** A stored line as the API returns it: the TTL bookkeeping field is storage, not log content. PURE. */
export function toLogEntry(data: Record<string, unknown>): LogEntry {
  const { [LOG_TTL_FIELD]: _ttl, ...rest } = data;
  return rest as unknown as LogEntry;
}

/** Does this line pass the equality filters? PURE. */
export function logMatches(row: Partial<LogEntry>, q: Pick<LogQuery, 'level' | 'event' | 'workspaceId'>): boolean {
  if (q.level && row.level !== q.level) return false;
  if (q.event && row.event !== q.event) return false;
  if (q.workspaceId && row.workspaceId !== q.workspaceId) return false;
  return true;
}

/** One newest-first page: rows, plus the cursor to pass for the next page (null at the end). */
export type LogPageFetcher<C> = (size: number, after: C | null) => Promise<{ rows: Partial<LogEntry>[]; next: C | null }>;

/**
 * Walk newest-first pages, keeping matching rows, until `want` matches, the end, or `budget` reads.
 * PURE over its fetcher — the real one is Firestore, the test's is an array, and the read count is the
 * same arithmetic in both. A page is never larger than the budget left, so `scanned <= budget` always.
 */
export async function collectNewestMatching<C>(
  fetchPage: LogPageFetcher<C>,
  match: (row: Partial<LogEntry>) => boolean,
  want: number,
  budget: number,
  pageSize: number = LOG_SCAN_PAGE,
): Promise<{ rows: Partial<LogEntry>[]; scanned: number; complete: boolean }> {
  const rows: Partial<LogEntry>[] = [];
  let scanned = 0;
  let after: C | null = null;
  for (;;) {
    const left = budget - scanned;
    if (left <= 0) return { rows, scanned, complete: false };
    const size = Math.max(1, Math.min(pageSize, left));
    const page = await fetchPage(size, after);
    scanned += page.rows.length;
    for (const r of page.rows) {
      if (match(r)) rows.push(r);
      if (rows.length >= want) return { rows, scanned, complete: true };
    }
    if (page.rows.length < size || page.next === null) return { rows, scanned, complete: true };
    after = page.next;
  }
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

/**
 * Query `server_logs`, newest first. Returns at most `limit` rows (default LOG_DEFAULT_LIMIT).
 *
 * Unfiltered: `orderBy('ts', 'desc').limit(n)` — exactly `n` reads. Filtered: the newest lines are read
 * a page at a time and matched in memory, stopping at `n` matches or LOG_FILTER_SCAN_BUDGET reads.
 * Equality filters are NOT sent to Firestore with the `orderBy`, because that pair needs a composite
 * index this project does not have — the 2026-08 version of this method threw on it and showed "no logs
 * match" for every filtered search. See the header for why the old index-free helper was replaced.
 * Exported (with the db as a parameter) so the read count is tested against a fake. Never throws.
 */
export async function queryServerLogs(
  db: Pick<admin.firestore.Firestore, 'collection'>,
  { level, event, workspaceId, since, limit }: LogQuery = {},
): Promise<LogPage> {
  const want = logLimit(limit);
  try {
    const col = db.collection('server_logs');
    const base = (typeof since === 'number' && Number.isFinite(since) ? col.where('ts', '>=', since) : col)
      .orderBy('ts', 'desc');
    const filtered = !!(level || event || workspaceId);
    if (!filtered) {
      const snap = await base.limit(want).get();
      return { entries: snap.docs.map((d) => toLogEntry(d.data())), scanned: snap.docs.length, complete: true };
    }
    const fetchPage: LogPageFetcher<admin.firestore.QueryDocumentSnapshot> = async (size, after) => {
      const snap = await (after ? base.startAfter(after) : base).limit(size).get();
      return { rows: snap.docs.map((d) => toLogEntry(d.data())), next: snap.docs.length ? snap.docs[snap.docs.length - 1] : null };
    };
    const r = await collectNewestMatching(fetchPage, (row) => logMatches(row, { level, event, workspaceId }), want, LOG_FILTER_SCAN_BUDGET);
    return { entries: r.rows as LogEntry[], scanned: r.scanned, complete: r.complete };
  } catch (e) {
    // Logged, not swallowed: an empty list from a failed read is exactly what hid the 2026-08 index bug.
    console.warn('[logStore] query failed:', String((e as Error)?.message ?? e).slice(0, 200));
    return { entries: [], scanned: 0, complete: false };
  }
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
      const ts = Date.now();
      const doc = stripUndefined({
        id: randomUUID(), ts, ...entry,
        // For a Firestore TTL policy on `server_logs` (see LOG_TTL_FIELD) — free deletion, no reads.
        [LOG_TTL_FIELD]: admin.firestore.Timestamp.fromMillis(ts + LOG_RETENTION_DAYS * 86_400_000),
      }) as LogEntry;
      // Fire-and-forget — never await; the reject handler catches async write failures.
      db.collection('server_logs').doc(doc.id).set(doc).catch(() => {});
    } catch {
      // Persistence is best-effort; the stdout audit line is the durable record.
    }
  }

  /** Query the durable log, newest first — see `queryServerLogs`. Never throws. */
  async queryPage(q: LogQuery = {}): Promise<LogPage> {
    const db = this.getDb();
    if (!db) return { entries: [], scanned: 0, complete: true };
    return queryServerLogs(db, q);
  }

  /** `queryPage` without the read accounting — the rows only. */
  async query(q: LogQuery = {}): Promise<LogEntry[]> {
    return (await this.queryPage(q)).entries;
  }
}

export const logStore = new LogStore();
