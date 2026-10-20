/**
 * Bounded, compare-and-set reviewer metadata. Never writes a diagnostic/report document.
 * Every accepted change and its idempotency receipt commit atomically with the current view.
 */
import { createHash } from 'node:crypto';
import { getServerDb } from './serverDb';
import { RETENTION_PURGE_TOKEN, hasRetentionFence, isRetentionPurgeToken } from './retentionFence';
import { FailedReportsInputError, failedReportDigest, redactFailedReport, settledFailure, validReportId } from './failedBuildReports';
import type { FailedBuildPage } from '../../lib/failedBuildReports';
import type { FailedReportAutopsyInput, FailedReportAutopsyRecord, FailedReportAutopsyView } from '../../lib/failedReportAutopsy';

const COLLECTION = 'admin_failed_report_autopsies';
const REPO = 'https://github.com/docasheesh-png/navbharatai';
const MAX_REVISIONS = 1_000;
export class FailedReportAutopsyConflict extends Error {}
export class FailedReportAutopsyNotFound extends Error {}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function reference(workspaceId: unknown, historyId: unknown): { workspaceId: string; historyId: string; id: string } {
  if (!validReportId(workspaceId) || typeof historyId !== 'string' ||
    !(historyId === 'latest' || /^\d{1,20}$/.test(historyId))) throw new FailedReportsInputError('Invalid report reference.');
  return { workspaceId, historyId, id: hash(JSON.stringify([workspaceId, historyId])) };
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(k => !keys.includes(k))) throw new FailedReportsInputError('Unexpected autopsy fields.');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new FailedReportsInputError(`Invalid ${name}.`);
  const trimmed = value.trim();
  if (redactFailedReport(trimmed) !== trimmed) throw new FailedReportsInputError(`Remove credentials from ${name}.`);
  return trimmed;
}
/** Evidence references are pinned to this repo, never fetched by this service. */
function evidenceUrl(value: unknown, kind: 'ledger' | 'pr' | 'ci', optional = false): string {
  if (optional && value === '') return '';
  const s = text(value, `${kind} evidence URL`, 1, 1000);
  const suffix = kind === 'ledger' ? /^\/blob\/[a-f0-9]{40}\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md(?:#[A-Za-z0-9_-]+)?$/ :
    kind === 'pr' ? /^\/pull\/[1-9]\d*$/ : /^\/actions\/runs\/[1-9]\d*(?:\/attempts\/[1-9]\d*)?$/;
  if (!s.startsWith(`${REPO}/`) || !suffix.test(s.slice(REPO.length)) ||
    s.split('/').some(segment => segment === '.' || segment === '..')) throw new FailedReportsInputError(`Use a pinned ${kind} evidence URL in the NavBharatAI repository.`);
  return s;
}
export function parseFailedReportAutopsy(value: unknown): FailedReportAutopsyInput {
  const v = object(value, ['expectedRevision', 'reportDigest', 'mutationId', 'status', 'summary', 'ledgerUrl', 'counts', 'blockers', 'verification', 'reason']);
  if (!Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0 || Number(v.expectedRevision) >= MAX_REVISIONS ||
    typeof v.reportDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.reportDigest) ||
    typeof v.mutationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.mutationId) ||
    !['in_progress', 'blocked', 'done'].includes(String(v.status))) throw new FailedReportsInputError('Invalid autopsy revision, digest, mutation id or status.');
  const counts = object(v.counts, ['total', 'resolved', 'blocked']);
  for (const key of ['total', 'resolved', 'blocked']) {
    if (!Number.isSafeInteger(counts[key]) || Number(counts[key]) < 0 || Number(counts[key]) > 10_000) throw new FailedReportsInputError('Autopsy counts must be nonnegative integers up to 10000.');
  }
  if (Number(counts.resolved) + Number(counts.blocked) > Number(counts.total)) throw new FailedReportsInputError('Resolved and blocked counts exceed the item total.');
  let verification: FailedReportAutopsyInput['verification'] = null;
  if (v.verification !== null) {
    const p = object(v.verification, ['scope', 'commitSha', 'pullRequestUrl', 'ciRunUrl', 'testSummary']);
    if (!['source_and_tests', 'historical_app'].includes(String(p.scope)) || typeof p.commitSha !== 'string' ||
      !/^[a-f0-9]{40}$/.test(p.commitSha)) throw new FailedReportsInputError('Invalid verification scope or commit.');
    verification = { scope: p.scope as 'source_and_tests' | 'historical_app', commitSha: p.commitSha,
      pullRequestUrl: evidenceUrl(p.pullRequestUrl, 'pr'), ciRunUrl: evidenceUrl(p.ciRunUrl, 'ci'),
      testSummary: text(p.testSummary, 'test proof', 20, 4000) };
  }
  const blockers = text(v.blockers, 'blockers', 0, 4000);
  const ledgerUrl = evidenceUrl(v.ledgerUrl, 'ledger', v.status !== 'done');
  if (v.status === 'blocked' && (!Number(counts.blocked) || blockers.length < 20)) throw new FailedReportsInputError('A blocked autopsy needs blocked items and what, why, required action and attempts.');
  if (v.status === 'done' && (counts.resolved !== counts.total || counts.blocked !== 0 || blockers || !verification)) {
    throw new FailedReportsInputError('Autopsy done requires every item resolved, no blockers, a pinned ledger and verification evidence. A partial review is not done.');
  }
  return { expectedRevision: Number(v.expectedRevision), reportDigest: v.reportDigest, mutationId: v.mutationId,
    status: v.status as FailedReportAutopsyInput['status'], summary: text(v.summary, 'review summary', 20, 4000),
    ledgerUrl, counts: { total: Number(counts.total), resolved: Number(counts.resolved), blocked: Number(counts.blocked) },
    blockers, verification, reason: text(v.reason, 'change reason', 3, 500) };
}
function view(reportDigest: string, record: FailedReportAutopsyRecord | null): FailedReportAutopsyView {
  return { reportDigest, revision: record?.revision ?? 0,
    state: !record ? 'not_started' : record.reportDigest !== reportDigest ? 'stale' : record.status, record };
}
function storedRecord(value: unknown, workspaceId: string, historyId: string): FailedReportAutopsyRecord | null {
  if (value === undefined) return null;
  // All read paths and the writer's parent transaction use this parser. A purge fence must also
  // refuse an idempotent replay: its receipt may already be gone during resumable child cleanup.
  if (hasRetentionFence(value)) throw new Error('Autopsy metadata cleanup is in progress. Retry later; no status was substituted.');
  try {
    const r = object(value, ['expectedRevision', 'reportDigest', 'mutationId', 'status', 'summary', 'ledgerUrl', 'counts',
      'blockers', 'verification', 'reason', 'revision', 'workspaceId', 'historyId', 'updatedAt', 'actor']);
    const { revision, updatedAt, actor, workspaceId: storedWorkspace, historyId: storedHistory, ...input } = r;
    const parsed = parseFailedReportAutopsy(input);
    if (revision !== parsed.expectedRevision + 1 || storedWorkspace !== workspaceId || storedHistory !== historyId ||
      typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || typeof actor !== 'string' ||
      !/^(?:admin|oauth):[A-Za-z0-9._@-]{1,128}$/.test(actor)) throw new Error('Invalid stored fields.');
    return { ...parsed, revision: Number(revision), workspaceId, historyId, updatedAt, actor };
  } catch { throw new Error('Stored autopsy metadata is invalid; no status was substituted.'); }
}
export async function readFailedReportAutopsy(workspaceId: string, historyId: string): Promise<FailedReportAutopsyView | null> {
  const r = reference(workspaceId, historyId), db = getServerDb();
  if (!db) throw new Error('Autopsy storage unavailable.');
  const root = db.collection('workspace_diagnostics_v3').doc(r.workspaceId);
  // One snapshot binds status to the retained evidence. A changing legacy "latest" cannot inherit done.
  return db.runTransaction(async tx => {
    const report = (await tx.get(r.historyId === 'latest' ? root : root.collection('history').doc(r.historyId))).data()?.report;
    if (!settledFailure(report)) return null;
    const stored = (await tx.get(db.collection(COLLECTION).doc(r.id))).data();
    return view(failedReportDigest(report), storedRecord(stored, r.workspaceId, r.historyId));
  });
}
export async function withFailedReportAutopsies(page: FailedBuildPage): Promise<FailedBuildPage> {
  if (!page.reports.length) return page;
  const db = getServerDb();
  if (!db) throw new Error('Autopsy storage unavailable.');
  const snapshots = await db.getAll(...page.reports.map(r => db.collection(COLLECTION).doc(reference(r.workspaceId, r.historyId).id)));
  return { ...page, reports: page.reports.map((r, i) => {
    const raw = snapshots[i].data();
    if (hasRetentionFence(raw)) {
      if (!isRetentionPurgeToken(raw?.[RETENTION_PURGE_TOKEN])) throw new Error('Stored autopsy cleanup fence is invalid.');
      const retained = { ...raw };
      delete retained[RETENTION_PURGE_TOKEN];
      // Only a valid fenced record gets the explicit list-only state; never hide corrupt metadata.
      storedRecord(retained, r.workspaceId, r.historyId);
      return { ...r, autopsy: { state: 'cleanup_in_progress' as const, revision: null } };
    }
    const record = storedRecord(raw, r.workspaceId, r.historyId);
    return { ...r, autopsy: { state: view(r.reportDigest, record ?? null).state, revision: record?.revision ?? 0 } };
  }) };
}
export async function updateFailedReportAutopsy(workspaceId: string, historyId: string, value: unknown, actor: string, now = Date.now()): Promise<FailedReportAutopsyView> {
  const r = reference(workspaceId, historyId), input = parseFailedReportAutopsy(value);
  // Only authenticated routes construct actor; no arbitrary actor value arrives in a tool argument.
  if (!/^(?:admin|oauth):[A-Za-z0-9._@-]{1,128}$/.test(actor)) throw new Error('Verified autopsy actor required.');
  const db = getServerDb();
  if (!db) throw new Error('Autopsy storage unavailable.');
  const root = db.collection('workspace_diagnostics_v3').doc(r.workspaceId), ref = db.collection(COLLECTION).doc(r.id);
  const receipt = ref.collection('mutations').doc(input.mutationId);
  const requestHash = hash(JSON.stringify({ input, actor }));
  return db.runTransaction(async tx => {
    const report = (await tx.get(r.historyId === 'latest' ? root : root.collection('history').doc(r.historyId))).data()?.report;
    if (!settledFailure(report)) throw new FailedReportAutopsyNotFound('No retained failed report at this reference.');
    const digest = failedReportDigest(report);
    const current = storedRecord((await tx.get(ref)).data(), r.workspaceId, r.historyId);
    const previous = (await tx.get(receipt)).data();
    if (previous) {
      if (previous.requestHash !== requestHash) throw new FailedReportAutopsyConflict('Mutation id was already used for a different change.');
      // A lost acknowledgement can be retried without duplicating the audit. Return current truth,
      // not an old success if another reviewer or a changing legacy report has moved since then.
      return view(digest, current ?? null);
    }
    if (digest !== input.reportDigest) throw new FailedReportAutopsyConflict('The retained report changed. Read it again before saving.');
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new FailedReportAutopsyConflict('Another reviewer updated this autopsy. Reload before saving.');
    const record: FailedReportAutopsyRecord = { ...input, revision: input.expectedRevision + 1,
      workspaceId: r.workspaceId, historyId: r.historyId, updatedAt: now, actor };
    tx.set(ref, record);
    tx.create(ref.collection('revisions').doc(String(record.revision).padStart(6, '0')), record);
    tx.create(receipt, { requestHash, revision: record.revision });
    return view(digest, record);
  });
}
