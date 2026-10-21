import { isBuildReportNumbering, type BuildReportNumbering } from './buildReportNumbering';
/** Private failed-report API contracts. No credentials or full reports in list rows. */
import type { FailedReportAutopsyView } from './failedReportAutopsy';
export interface FailedBuildRow {
  numbering?: BuildReportNumbering;
  workspaceId: string;
  historyId: string;
  buildId: string | null;
  startedAt: number;
  endedAt: number;
  appLabel: string;
  rootCause: string | null;
  reportDigest: string;
  autopsy?: Pick<FailedReportAutopsyView, 'state' | 'revision'> | { state: 'cleanup_in_progress'; revision: null };
}
export interface FailedBuildPage {
  reports: FailedBuildRow[];
  nextCursor: string | null;
  scanned: number;
}
export interface FailedReportAccess {
  id: string;
  label: string;
  createdAt: number;
  expiresAt: number;
}
export function isFailedBuildPage(value: unknown): value is FailedBuildPage {
  if (!value || typeof value !== 'object') return false;
  const p = value as FailedBuildPage;
  return Array.isArray(p.reports) && (p.nextCursor === null || typeof p.nextCursor === 'string') &&
    typeof p.scanned === 'number' && p.reports.every((r) => r && typeof r.workspaceId === 'string' &&
      typeof r.historyId === 'string' && typeof r.startedAt === 'number' && typeof r.endedAt === 'number' &&
      typeof r.appLabel === 'string' && (r.numbering === undefined || isBuildReportNumbering(r.numbering)) && (r.autopsy === undefined || (r.autopsy && typeof r.autopsy === 'object' &&
        (r.autopsy.state === 'cleanup_in_progress' ? r.autopsy.revision === null :
          ['not_started', 'stale', 'in_progress', 'blocked', 'done'].includes(r.autopsy.state) &&
          Number.isSafeInteger(r.autopsy.revision) && r.autopsy.revision >= 0 && r.autopsy.revision <= 1000 &&
          (r.autopsy.state === 'not_started' ? r.autopsy.revision === 0 : r.autopsy.revision > 0)))));
}
