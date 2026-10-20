/** Reviewer metadata is separate from immutable diagnostic evidence. */
export type FailedReportAutopsyStatus = 'in_progress' | 'blocked' | 'done';
export interface FailedReportAutopsyCounts {
  total: number;
  resolved: number;
  blocked: number;
}
export interface FailedReportAutopsyVerification {
  scope: 'source_and_tests' | 'historical_app';
  commitSha: string;
  pullRequestUrl: string;
  ciRunUrl: string;
  testSummary: string;
}
export interface FailedReportAutopsyInput {
  expectedRevision: number;
  reportDigest: string;
  mutationId: string;
  status: FailedReportAutopsyStatus;
  summary: string;
  ledgerUrl: string;
  counts: FailedReportAutopsyCounts;
  blockers: string;
  verification: FailedReportAutopsyVerification | null;
  reason: string;
}
export interface FailedReportAutopsyRecord extends FailedReportAutopsyInput {
  revision: number;
  workspaceId: string;
  historyId: string;
  updatedAt: number;
  actor: string;
}
export interface FailedReportAutopsyView {
  reportDigest: string;
  revision: number;
  state: 'not_started' | 'stale' | FailedReportAutopsyStatus;
  record: FailedReportAutopsyRecord | null;
}
export function isFailedReportAutopsyView(value: unknown): value is FailedReportAutopsyView {
  if (!value || typeof value !== 'object') return false;
  const v = value as FailedReportAutopsyView;
  if (typeof v.reportDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.reportDigest) ||
    !Number.isSafeInteger(v.revision) || v.revision < 0 || v.revision > 1000 ||
    !['not_started', 'stale', 'in_progress', 'blocked', 'done'].includes(v.state)) return false;
  if (v.record === null) return v.state === 'not_started' && v.revision === 0;
  const r = v.record;
  if (!r || typeof r !== 'object' || r.revision !== v.revision || r.expectedRevision !== r.revision - 1 ||
    !['in_progress', 'blocked', 'done'].includes(r.status) || typeof r.reportDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.reportDigest) ||
    (v.state === 'stale' ? r.reportDigest === v.reportDigest : v.state !== r.status || r.reportDigest !== v.reportDigest) ||
    typeof r.summary !== 'string' || r.summary.length < 20 || r.summary.length > 4000 ||
    typeof r.ledgerUrl !== 'string' || typeof r.reason !== 'string' || r.reason.length < 3 ||
    typeof r.blockers !== 'string' || typeof r.mutationId !== 'string' ||
    typeof r.actor !== 'string' || typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt) ||
    !r.counts || !['total', 'resolved', 'blocked'].every(k => {
      const n = r.counts[k as keyof FailedReportAutopsyCounts]; return Number.isSafeInteger(n) && n >= 0 && n <= 10000;
    }) || r.counts.resolved + r.counts.blocked > r.counts.total) return false;
  if (r.verification !== null) {
    const p = r.verification;
    if (!p || typeof p !== 'object' || !['source_and_tests', 'historical_app'].includes(p.scope) ||
      typeof p.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(p.commitSha) ||
      typeof p.pullRequestUrl !== 'string' || typeof p.ciRunUrl !== 'string' ||
      typeof p.testSummary !== 'string' || p.testSummary.length < 20 || p.testSummary.length > 4000) return false;
  }
  if (r.status === 'done' && (r.counts.total !== r.counts.resolved || r.counts.blocked !== 0 ||
    r.blockers || !r.ledgerUrl || !r.verification)) return false;
  return r.status !== 'blocked' || (r.counts.blocked > 0 && r.blockers.length >= 20);
}
