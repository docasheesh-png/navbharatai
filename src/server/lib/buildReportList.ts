/**
 * EVERY BUILD REPORT, IN NUMBER ORDER, FILTERABLE BY OUTCOME (admin 2026-11-02: "sabhi build report
 * failedbr me aye. sort/filter option bana do").
 *
 * The failed-reports list walks workspaces one by one, so it can only ever be in workspace order and
 * only ever holds failures. This list reads the build report registry instead (`buildReportRegistry.ts`),
 * which is ordered by the one permanent number every report carries — so "newest first" and "oldest
 * first" are exact, global, and stable across pages, and the outcome filter costs nothing extra.
 *
 * Only Firestore's automatic single-field index on `number` is used. The outcome filter is applied
 * while paging, under a fixed scan budget; a page that ran out of budget says so with a cursor, and an
 * empty page with a cursor is NOT the end of the list.
 */
import { getServerDb } from './serverDb';
import { BUILD_REPORT_NUMBERS_COLLECTION, BUILD_REPORT_OUTCOMES, counterRef, readyCounter, buildReportOutcome, registryRef,
  validBuildReportNumber, type BuildReportOutcome, type BuildReportRegistryRow } from './buildReportRegistry';
import { FailedReportsInputError, failedReportDigest, redactFailedReport, validReportId } from './failedBuildReports';

export const BUILD_REPORT_FILTERS = ['all', ...BUILD_REPORT_OUTCOMES] as const;
export type BuildReportFilter = typeof BUILD_REPORT_FILTERS[number];
export const BUILD_REPORT_ORDERS = ['newest', 'oldest'] as const;
export type BuildReportOrder = typeof BUILD_REPORT_ORDERS[number];

const PAGE = 100;
const MAX_SCANNED = 1000;

export interface BuildReportListRow {
  number: number;
  outcome: BuildReportOutcome;
  workspaceId: string;
  historyId: string;
  buildId: string | null;
  startedAt: number;
  endedAt: number | null;
  appLabel: string | null;
  rootCause: string | null;
  /** False when the report itself is no longer retained; the number stays reserved for it. */
  retained: boolean;
  reportDigest: string | null;
}

export interface BuildReportListPage {
  reports: BuildReportListRow[];
  nextCursor: string | null;
  scanned: number;
  filter: { outcome: BuildReportFilter; order: BuildReportOrder };
  numbering: { state: 'ready' | 'pending'; highestAssigned: number | null };
}

interface Cursor { n: number; o: BuildReportOrder; f: BuildReportFilter }

function choice<T extends string>(raw: unknown, allowed: readonly T[], fallback: T, name: string): T {
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) throw new FailedReportsInputError(`${name} must be one of: ${allowed.join(', ')}.`);
  return raw as T;
}

/** A cursor belongs to one filter and one order; reusing it with another would skip or repeat rows. */
function cursorOf(raw: unknown, filter: BuildReportFilter, order: BuildReportOrder): number | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 256) throw new FailedReportsInputError('Invalid cursor.');
  let c: Cursor & { v?: unknown };
  try { c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw new FailedReportsInputError('Invalid cursor.'); }
  if (c?.v !== 2 || !validBuildReportNumber(c.n)) throw new FailedReportsInputError('Invalid cursor.');
  if (c.o !== order || c.f !== filter) throw new FailedReportsInputError('This cursor belongs to a different sort or filter. Start again without a cursor.');
  return c.n;
}
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify({ v: 2, ...c })).toString('base64url');

function summary(entry: BuildReportRegistryRow, report: Record<string, unknown> | undefined): BuildReportListRow {
  const retained = !!report && report.startedAt === entry.startedAt;
  const r = retained ? redactFailedReport(report) as Record<string, unknown> : undefined;
  return {
    number: entry.number,
    outcome: entry.outcome,
    workspaceId: entry.workspaceId,
    historyId: entry.historyId,
    buildId: typeof r?.buildId === 'string' ? r.buildId : null,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt ?? null,
    appLabel: typeof r?.prompt === 'string' ? r.prompt.split('\n')[0].slice(0, 180) : retained ? 'Untitled build' : null,
    rootCause: typeof r?.rootCause === 'string' ? r.rootCause.slice(0, 1000) : null,
    retained,
    reportDigest: retained ? failedReportDigest(report) : null,
  };
}

/** One page of every build report, by permanent number. No catch-to-empty: storage failure throws. */
export async function readBuildReportList(args: { cursor?: unknown; limit?: unknown; outcome?: unknown; order?: unknown } = {}): Promise<BuildReportListPage> {
  const outcome = choice(args.outcome, BUILD_REPORT_FILTERS, 'all', 'outcome');
  const order = choice(args.order, BUILD_REPORT_ORDERS, 'newest', 'order');
  const after = cursorOf(args.cursor, outcome, order);
  const limit = args.limit === undefined ? 20 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FailedReportsInputError('Limit must be between 1 and 50.');
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');

  const base = db.collection(BUILD_REPORT_NUMBERS_COLLECTION).orderBy('number', order === 'newest' ? 'desc' : 'asc');
  const matches: BuildReportRegistryRow[] = [];
  let scanned = 0;
  let last = after;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let exhausted = false;
  while (matches.length < limit && scanned < MAX_SCANNED) {
    const want = Math.min(PAGE, MAX_SCANNED - scanned);
    const from: FirebaseFirestore.Query = lastDoc ? base.startAfter(lastDoc) : last === null ? base : base.startAfter(last);
    const page: FirebaseFirestore.QuerySnapshot = await from.limit(want).get();
    for (const doc of page.docs) {
      lastDoc = doc;
      scanned++;
      const entry = doc.data() as BuildReportRegistryRow;
      if (!validBuildReportNumber(entry?.number)) continue;
      last = entry.number;
      if (outcome === 'all' || entry.outcome === outcome) matches.push(entry);
      if (matches.length >= limit) break;
    }
    if (page.size < want && matches.length < limit) { exhausted = true; break; }
  }

  const reports = await Promise.all(matches.map(async (entry) => {
    const root = db.collection('workspace_diagnostics_v3').doc(entry.workspaceId);
    const snap = await (entry.historyId === 'latest' ? root : root.collection('history').doc(entry.historyId)).get();
    return summary(entry, snap.data()?.report as Record<string, unknown> | undefined);
  }));
  const counter = readyCounter((await counterRef(db).get()).data());
  return {
    reports,
    nextCursor: exhausted || last === null ? null : encodeCursor({ n: last, o: order, f: outcome }),
    scanned,
    filter: { outcome, order },
    numbering: { state: counter ? 'ready' : 'pending', highestAssigned: counter ? counter.nextNumber - 1 : null },
  };
}

/**
 * One saved report of ANY outcome, scrubbed, with the digest of exactly these bytes and its number.
 * Returns null when no report is retained at this reference.
 */
export async function readBuildReportWithDigest(workspaceId: unknown, historyId: unknown): Promise<{
  report: unknown; reportDigest: string; number: number | null; outcome: BuildReportOutcome;
} | null> {
  if (!validReportId(workspaceId) || typeof historyId !== 'string' || !(historyId === 'latest' || /^\d{1,20}$/.test(historyId))) {
    throw new FailedReportsInputError('Invalid report reference.');
  }
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const root = db.collection('workspace_diagnostics_v3').doc(workspaceId);
  const doc = await (historyId === 'latest' ? root : root.collection('history').doc(historyId)).get();
  const data = doc.data();
  const report = data?.report as Record<string, unknown> | undefined;
  const startedAt = report?.startedAt;
  if (!report || typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  const entry = (await registryRef(db, workspaceId, startedAt).get()).data();
  const scrubbed = redactFailedReport(report);
  return {
    report: scrubbed,
    reportDigest: failedReportDigest(report),
    number: validBuildReportNumber(entry?.number) ? entry.number : null,
    outcome: buildReportOutcome(report, data?.inProgress === true),
  };
}
