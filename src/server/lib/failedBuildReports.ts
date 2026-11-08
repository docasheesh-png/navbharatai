import { settledFailure } from './failedReportEligibility';
export { settledFailure } from './failedReportEligibility';
/** Read existing retained history; never add work to the build/write path. */
import { FieldPath } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { getServerDb } from './serverDb';
import { numberBuildReports } from './buildReportNumbering';
import { counterRef, readyCounter, scanRegistry, validBuildReportNumber } from './buildReportRegistry';
import { redactSecrets } from '../AgentV3/SourceSecretRedactor';
import type { FailedBuildPage, FailedBuildRow, FailedBuildReadObservation } from '../../lib/failedBuildReports';

const COLLECTION = 'workspace_diagnostics_v3';
const MAX_SCANNED = 100;
const MAX_WORKSPACES = 10;
interface Cursor { w: string; b: string; after: boolean }
export class FailedReportsInputError extends Error {}
export function validReportId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,400}$/.test(value) && value !== '.' && value !== '..';
}
function cursorOf(raw?: unknown): Cursor {
  if (raw === undefined || raw === '') return { w: '', b: '', after: false };
  if (typeof raw !== 'string' || raw.length > 2048) throw new FailedReportsInputError('Invalid cursor.');
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (c.v !== 1 || !validReportId(c.w) || (c.b !== '' && !/^\d{1,20}$/.test(c.b)) || typeof c.after !== 'boolean') throw new Error();
    return { w: c.w, b: c.b, after: c.after };
  } catch { throw new FailedReportsInputError('Invalid cursor.'); }
}
function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...c })).toString('base64url');
}
/** Stored reports are already scrubbed; scrub again at this external export boundary. */
export function redactFailedReport(value: unknown): unknown {
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 80) return '[Omitted: nesting limit]';
    if (typeof v === 'string') return redactSecrets(v)
      .replace(/\bnbfr_[A-Za-z0-9_-]{43}\b/g, '[REDACTED:report-access]')
      .replace(/\b(?:nbfo_|nbfrt_|nbfcode_)[a-f0-9]{64}\.[A-Za-z0-9_-]{43}\b/g, '[REDACTED:report-oauth]');
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      /(?:^|[_-])(?:password|passwd|pwd|secret|token|access[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|private[_-]?key|client[_-]?secret)$/i.test(k)
        ? '[REDACTED:credential]' : walk(x, depth + 1)]));
    return v;
  };
  return walk(value, 0);
}
/** Hash exactly the exported snapshot; never apply a second policy pass here. */
function scrubbedReportDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
/** Canonical scrubbed evidence digest: object key order cannot create a false revision. */
export function failedReportDigest(value: unknown): string {
  return scrubbedReportDigest(redactFailedReport(value));
}
function row(workspaceId: string, historyId: string, r: Record<string, unknown> & { startedAt: number; endedAt: number }): FailedBuildRow {
  return redactFailedReport({ workspaceId, historyId, reportDigest: failedReportDigest(r), buildId: typeof r.buildId === 'string' ? r.buildId : null,
    startedAt: r.startedAt, endedAt: r.endedAt,
    appLabel: typeof r.prompt === 'string' ? r.prompt.split('\n')[0].slice(0, 180) : 'Untitled build',
    rootCause: typeof r.rootCause === 'string' ? r.rootCause.slice(0, 1000) : null }) as FailedBuildRow;
}
/** Only an opaque deployment fingerprint crosses this private read boundary. */
export function failedBuildReadObservation(ordering: FailedBuildReadObservation['ordering'] = 'newest-first'): FailedBuildReadObservation {
  const revision = process.env.K_REVISION?.trim();
  return {
    observedAt: Date.now(),
    deployment: revision ? createHash('sha256').update(revision).digest('hex').slice(0, 16) : null,
    scope: 'retained-settled-failures',
    ordering,
  };
}
/**
 * Walk ALL workspaces and their retained per-build history, including failures preceding a green build.
 * Name-ordered cursors need only Firestore's built-in indexes. A bounded empty batch is NOT an empty inbox;
 * callers must follow nextCursor until null. No catch-to-empty: an unavailable store is an HTTP 503.
 */
const MAX_REGISTRY_SCANNED = 300;
const NEWEST_CURSOR_VERSION = 2;

/**
 * 🔢 NEWEST FIRST, AT A GLANCE (admin 2026-11-02: "koi aisa system banao, jisse ek nazar me hi sabse new br pata
 * lag jaye … sabse pahle show hone wali br sabse new ho"). The list used to walk workspaces by document id, so the
 * newest failure sat anywhere among ~640 rows and finding it meant reading them all. Every report now carries a
 * permanent number given at its first save, oldest first (buildReportRegistry.ts), so the list reads the registry
 * from the HIGHEST number down: row 1 of page 1 is the newest failed build, every time.
 *
 * Until the registry's counter is ready (the one-time backfill has not run) the old workspace walk serves the page,
 * marked `ordering: 'workspace-history'`, so no report can disappear from the list while numbering is pending.
 */
export async function readFailedBuildPage(rawCursor?: unknown, rawLimit?: unknown): Promise<FailedBuildPage> {
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FailedReportsInputError('Limit must be between 1 and 50.');
  // A malformed cursor is the caller's error whatever the storage state, so it is judged before storage is touched.
  const cursor = classifyCursor(rawCursor);
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const counter = readyCounter((await counterRef(db).get()).data());
  if (!counter) {
    if (cursor.kind === 'newest') throw new FailedReportsInputError('This cursor belongs to the newest-first order, which is not available yet. Start again without a cursor.');
    return readFailedBuildPageByWorkspace(rawCursor, limit);
  }
  if (cursor.kind === 'workspace') throw new FailedReportsInputError('This cursor is from the older workspace order. The list is now newest first: start again without a cursor.');
  const after = cursor.kind === 'newest' ? cursor.n : null;
  // A failure is a settled report with ok=false: the registry's `failed` and `stopped` outcomes, as settledFailure says.
  const { matches, last, exhausted, scanned } = await scanRegistry(db, {
    order: 'newest', after, limit, maxScanned: MAX_REGISTRY_SCANNED, keep: (e) => e.outcome === 'failed' || e.outcome === 'stopped',
  });
  const highest = counter.nextNumber - 1;
  const asOf = Date.now();
  const rows = await Promise.all(matches.map(async (entry) => {
    const root = db.collection(COLLECTION).doc(entry.workspaceId);
    const report = (await (entry.historyId === 'latest' ? root : root.collection('history').doc(entry.historyId)).get()).data()?.report;
    // The registry names a report; only one still retained AND still a failure is listed (an expired one is a gap).
    if (!settledFailure(report) || report.startedAt !== entry.startedAt) return null;
    return { ...row(entry.workspaceId, entry.historyId, report), numbering: { ordinal: entry.number, total: Math.max(highest, entry.number), asOf }, permanentReportId: entry.number };
  }));
  return {
    reports: rows.filter((r): r is NonNullable<typeof r> => r !== null),
    nextCursor: exhausted || last === null ? null : Buffer.from(JSON.stringify({ v: NEWEST_CURSOR_VERSION, n: last })).toString('base64url'),
    scanned,
    observation: failedBuildReadObservation('newest-first'),
  };
}

/** Which order a cursor belongs to: a newest-first number (v2), a workspace walk (v1, validated in full), or none. */
function classifyCursor(raw: unknown): { kind: 'none' } | { kind: 'workspace' } | { kind: 'newest'; n: number } {
  if (raw === undefined || raw === '') return { kind: 'none' };
  if (typeof raw !== 'string' || raw.length > 2048) throw new FailedReportsInputError('Invalid cursor.');
  let c: { v?: unknown; n?: unknown };
  try { c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { throw new FailedReportsInputError('Invalid cursor.'); }
  if (c?.v === NEWEST_CURSOR_VERSION && validBuildReportNumber(c.n)) return { kind: 'newest', n: c.n };
  cursorOf(raw); // throws on anything that is not a well-formed workspace cursor either
  return { kind: 'workspace' };
}

/** The pre-registry walk: every workspace's retained history in document-id order. Used only while numbering is pending. */
async function readFailedBuildPageByWorkspace(rawCursor: unknown, limit: number): Promise<FailedBuildPage> {
  const c = cursorOf(rawCursor);
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const reports: FailedBuildRow[] = [];
  let scanned = 0;
  // `numbering.ordinal` IS the permanent number (buildReportRegistry.ts); `permanentReportId` carries the
  // same value for callers that read that field. One report, one number, on every screen and tool.
  const page = async (nextCursor: string | null): Promise<FailedBuildPage> => ({
    reports: (await numberBuildReports('failed', reports, r => r.historyId)).map((r) =>
      r.numbering.ordinal !== null ? { ...r, permanentReportId: r.numbering.ordinal } : r),
    nextCursor, scanned, observation: failedBuildReadObservation('workspace-history'),
  });
  for (let workspace = 0; workspace < MAX_WORKSPACES && scanned < MAX_SCANNED; workspace++) {
    let query = db.collection(COLLECTION).orderBy(FieldPath.documentId());
    if (c.w) query = c.after ? query.startAfter(c.w) : query.startAt(c.w);
    const parents = await query.limit(1).get();
    if (parents.empty) return page(null);
    const parent = parents.docs[0];
    if (parent.id !== c.w || c.after) c.b = '';
    c.w = parent.id; c.after = false;
    const root = parent.ref;
    const history = root.collection('history');
    if (!c.b) {
      const latest = parent.data().report;
      // Legacy latest-only reports remain readable, without duplicating their normal history row.
      if (settledFailure(latest) && !(await history.doc(String(latest.startedAt)).get()).exists) {
        reports.push(row(parent.id, 'latest', latest));
      }
      c.b = '0'; scanned++;
      if (reports.length >= limit) return page(encodeCursor(c));
    }
    const want = Math.min(50, MAX_SCANNED - scanned);
    if (want === 0) break;
    const entries = await history.orderBy(FieldPath.documentId()).startAfter(c.b).limit(want).get();
    for (const doc of entries.docs) {
      c.b = doc.id; scanned++;
      const r = doc.data().report;
      if (settledFailure(r)) reports.push(row(parent.id, doc.id, r));
      if (reports.length >= limit) return page(encodeCursor(c));
    }
    if (entries.size < want) { c.after = true; c.b = ''; }
    else workspace--; // continue the same workspace, still under the hard document budget
  }
  return page(encodeCursor(c));
}
/** One stored read and one redaction pass bind the digest to the exact returned evidence. */
export async function readFailedBuildWithDigest(workspaceId: string, historyId: string): Promise<{ report: unknown; reportDigest: string } | null> {
  if (!validReportId(workspaceId) || !(historyId === 'latest' || /^\d{1,20}$/.test(historyId))) throw new FailedReportsInputError('Invalid report reference.');
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const root = db.collection(COLLECTION).doc(workspaceId);
  const doc = await (historyId === 'latest' ? root : root.collection('history').doc(historyId)).get();
  const report = doc.data()?.report;
  if (!settledFailure(report)) return null;
  const scrubbed = redactFailedReport(report);
  return { report: scrubbed, reportDigest: scrubbedReportDigest(scrubbed) };
}

/** Compatibility for internal callers that only need the already-scrubbed report. */
export async function readFailedBuild(workspaceId: string, historyId: string): Promise<unknown | null> {
  return (await readFailedBuildWithDigest(workspaceId, historyId))?.report ?? null;
}
