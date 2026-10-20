/** Read existing retained history; never add work to the build/write path. */
import { FieldPath } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { getServerDb } from './serverDb';
import { redactSecrets } from '../AgentV3/SecretRedactor';
import type { FailedBuildPage, FailedBuildRow } from '../../lib/failedBuildReports';

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
export function settledFailure(raw: unknown): raw is Record<string, unknown> & { startedAt: number; endedAt: number } {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return r.ok === false && typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt > 0 &&
    typeof r.endedAt === 'number' && Number.isFinite(r.endedAt) && r.endedAt >= r.startedAt;
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
/** Canonical scrubbed evidence digest: object key order cannot create a false revision. */
export function failedReportDigest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
    v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(redactFailedReport(value)))).digest('hex');
}
function row(workspaceId: string, historyId: string, r: Record<string, unknown> & { startedAt: number; endedAt: number }): FailedBuildRow {
  return redactFailedReport({ workspaceId, historyId, reportDigest: failedReportDigest(r), buildId: typeof r.buildId === 'string' ? r.buildId : null,
    startedAt: r.startedAt, endedAt: r.endedAt,
    appLabel: typeof r.prompt === 'string' ? r.prompt.split('\n')[0].slice(0, 180) : 'Untitled build',
    rootCause: typeof r.rootCause === 'string' ? r.rootCause.slice(0, 1000) : null }) as FailedBuildRow;
}
/**
 * Walk ALL workspaces and their retained per-build history, including failures preceding a green build.
 * Name-ordered cursors need only Firestore's built-in indexes. A bounded empty batch is NOT an empty inbox;
 * callers must follow nextCursor until null. No catch-to-empty: an unavailable store is an HTTP 503.
 */
export async function readFailedBuildPage(rawCursor?: unknown, rawLimit?: unknown): Promise<FailedBuildPage> {
  const c = cursorOf(rawCursor);
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new FailedReportsInputError('Limit must be between 1 and 50.');
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const reports: FailedBuildRow[] = [];
  let scanned = 0;
  for (let workspace = 0; workspace < MAX_WORKSPACES && scanned < MAX_SCANNED; workspace++) {
    let query = db.collection(COLLECTION).orderBy(FieldPath.documentId());
    if (c.w) query = c.after ? query.startAfter(c.w) : query.startAt(c.w);
    const parents = await query.limit(1).get();
    if (parents.empty) return { reports, nextCursor: null, scanned };
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
      if (reports.length >= limit) return { reports, nextCursor: encodeCursor(c), scanned };
    }
    const want = Math.min(50, MAX_SCANNED - scanned);
    if (want === 0) break;
    const entries = await history.orderBy(FieldPath.documentId()).startAfter(c.b).limit(want).get();
    for (const doc of entries.docs) {
      c.b = doc.id; scanned++;
      const r = doc.data().report;
      if (settledFailure(r)) reports.push(row(parent.id, doc.id, r));
      if (reports.length >= limit) return { reports, nextCursor: encodeCursor(c), scanned };
    }
    if (entries.size < want) { c.after = true; c.b = ''; }
    else workspace--; // continue the same workspace, still under the hard document budget
  }
  return { reports, nextCursor: encodeCursor(c), scanned };
}
export async function readFailedBuild(workspaceId: string, historyId: string): Promise<unknown | null> {
  if (!validReportId(workspaceId) || !(historyId === 'latest' || /^\d{1,20}$/.test(historyId))) throw new FailedReportsInputError('Invalid report reference.');
  const db = getServerDb();
  if (!db) throw new Error('Report storage unavailable.');
  const root = db.collection(COLLECTION).doc(workspaceId);
  const doc = await (historyId === 'latest' ? root : root.collection('history').doc(historyId)).get();
  const report = doc.data()?.report;
  return settledFailure(report) ? redactFailedReport(report) : null;
}
