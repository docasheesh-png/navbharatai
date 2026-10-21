/** Read-only, bounded metadata snapshots. No index deployment or build-path writes.
 * Cache is instance-local: another cold server instance pays its own bounded scan. At 410
 * workspaces / 604 histories, latest costs ~410 document reads and failed ~1,014 plus minimum
 * charges for empty history queries. No background refresh. Firestore read-only transactions
 * make one attempt; counters also live outside the callback to bound any future retry behavior.
 */
import { FieldPath, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import { getServerDb } from './serverDb';
import type { BuildReportNumbering } from '../../lib/buildReportNumbering';

export type ReportNumberingCohort = 'latest' | 'failed';
const COLLECTION = 'workspace_diagnostics_v3';
const PAGE = 100;
const MAX_WORKSPACES = 1000;
const MAX_DOCUMENTS = 5000;
const MAX_QUERIES = 2000;
const MAX_MS = 30_000;
const TTL = 10 * 60_000;
const FAILURE_TTL = 30_000;
const FIELDS = ['report.startedAt', 'report.endedAt', 'report.ok', 'savedAt'];
interface Candidate { key: string; startedAt: number }
interface Snapshot { ranks: Map<string, { ordinal: number; startedAt: number }>; asOf: number }
interface CacheEntry { expires: number; pending: boolean; promise: Promise<Snapshot | null> }
const cache = new WeakMap<Firestore, Partial<Record<ReportNumberingCohort, CacheEntry>>>();
const unavailable = (): BuildReportNumbering => ({ ordinal: null, total: null, asOf: null });
const keyOf = (workspaceId: string, historyId: string) => JSON.stringify([workspaceId, historyId]);
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
function failed(report: Record<string, unknown> | undefined): boolean {
  return !!report && report.ok === false && validTime(report.startedAt) &&
    typeof report.endedAt === 'number' && Number.isFinite(report.endedAt) && report.endedAt >= report.startedAt;
}

async function scan(db: Firestore, cohort: ReportNumberingCohort, drained: () => void): Promise<Snapshot> {
  const asOf = Date.now();
  let cancelled = false, documents = 0, queries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = Promise.resolve().then(() => db.runTransaction(async (tx: Transaction) => {
    const read = async (query: Query) => {
      if (cancelled || Date.now() - asOf >= MAX_MS || ++queries > MAX_QUERIES) throw new Error('Numbering scan budget exceeded.');
      const page = await tx.get(query.limit(PAGE).select(...FIELDS));
      documents += page.size;
      if (cancelled || documents > MAX_DOCUMENTS) throw new Error('Numbering scan budget exceeded.');
      return page;
    };
    const candidates: Candidate[] = [];
    const roots = db.collection(COLLECTION).orderBy(FieldPath.documentId());
    let query: Query = roots;
    let workspaces = 0;
    for (;;) {
      const parents = await read(query);
      workspaces += parents.size;
      if (workspaces > MAX_WORKSPACES) throw new Error('Numbering workspace budget exceeded.');
      // At most eight metadata history queries in flight; no full reports, prompts or identities.
      for (let offset = 0; offset < parents.docs.length; offset += 8) {
        const batch = parents.docs.slice(offset, offset + 8).map(async parent => {
          const data = parent.data(), latest = data.report as Record<string, unknown> | undefined;
          if (cohort === 'latest') {
            // Match the existing savedAt-ordered list's universe, before its date/limit filters.
            if (data.savedAt === undefined) return;
            if (!validTime(latest?.startedAt)) throw new Error('A retained report has no chronological timestamp.');
            candidates.push({ key: keyOf(parent.id, String(latest.startedAt)), startedAt: latest.startedAt });
            return;
          }
          const history = parent.ref.collection('history').orderBy(FieldPath.documentId());
          let historyQuery: Query = history;
          let latestHasHistory = false;
          for (;;) {
            const entries = await read(historyQuery);
            for (const doc of entries.docs) {
              if (doc.id === String(latest?.startedAt)) latestHasHistory = true;
              const report = doc.data().report as Record<string, unknown> | undefined;
              if (failed(report)) candidates.push({ key: keyOf(parent.id, doc.id), startedAt: report!.startedAt as number });
            }
            if (entries.size < PAGE) break;
            historyQuery = history.startAfter(entries.docs[entries.docs.length - 1]);
          }
          if (!latestHasHistory && failed(latest)) candidates.push({ key: keyOf(parent.id, 'latest'), startedAt: latest!.startedAt as number });
        });
        try { await Promise.all(batch); } catch (error) {
          cancelled = true;
          await Promise.allSettled(batch);
          throw error;
        }
      }
      if (parents.size < PAGE) break;
      query = roots.startAfter(parents.docs[parents.docs.length - 1]);
    }
    candidates.sort((a, b) => a.startedAt - b.startedAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { ranks: new Map(candidates.map((row, index) => [row.key, { ordinal: index + 1, startedAt: row.startedAt }])), asOf };
  }, { readOnly: true })).finally(drained);
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { cancelled = true; reject(new Error('Numbering scan timed out.')); }, MAX_MS);
    })]);
  } finally {
    cancelled = true;
    if (timer) clearTimeout(timer);
  }
}

/** Lazy authenticated-list reads only. A failure never replaces the report list or invents a rank. */
export async function numberBuildReports<T extends { workspaceId: string; startedAt?: number }>(
  cohort: ReportNumberingCohort, rows: T[], historyId: (row: T) => string,
): Promise<Array<T & { numbering: BuildReportNumbering }>> {
  if (!rows.length) return [];
  const db = getServerDb();
  if (!db) return rows.map(row => ({ ...row, numbering: unavailable() }));
  let entries = cache.get(db);
  if (!entries) { entries = {}; cache.set(db, entries); }
  let entry = entries[cohort];
  if (!entry || (!entry.pending && entry.expires <= Date.now())) {
    const next: CacheEntry = { expires: Infinity, pending: true, promise: Promise.resolve(null) };
    next.promise = scan(db, cohort, () => { next.pending = false; }).then(snapshot => {
      next.expires = Date.now() + TTL; return snapshot;
    }, () => { next.expires = Date.now() + FAILURE_TTL; return null; });
    entries[cohort] = entry = next;
  }
  const snapshot = await entry.promise;
  return rows.map(row => {
    const rank = snapshot?.ranks.get(keyOf(row.workspaceId, historyId(row)));
    const numbering = rank && rank.startedAt === row.startedAt
      ? { ordinal: rank.ordinal, total: snapshot!.ranks.size, asOf: snapshot!.asOf } : unavailable();
    return { ...row, numbering };
  });
}

export class ReportNumberingInputError extends Error {}
/** Only bounded references enter the metadata route; never reflect a caller's extra fields. */
export async function readBuildReportNumbers(cohort: ReportNumberingCohort, raw: unknown) {
  if (!Array.isArray(raw) || raw.length > (cohort === 'latest' ? 500 : 50)) throw new ReportNumberingInputError();
  const rows = raw.map(row => {
    if (!row || typeof row !== 'object' || typeof row.workspaceId !== 'string' ||
      !/^[A-Za-z0-9._-]{1,400}$/.test(row.workspaceId) || ['.', '..'].includes(row.workspaceId) ||
      typeof row.historyId !== 'string' || !/^(?:latest|\d{1,20})$/.test(row.historyId) ||
      !validTime(row.startedAt) || (cohort === 'latest' && row.historyId !== String(row.startedAt))) throw new ReportNumberingInputError();
    return { workspaceId: row.workspaceId as string, historyId: row.historyId as string, startedAt: row.startedAt as number };
  });
  return numberBuildReports(cohort, rows, row => row.historyId);
}
