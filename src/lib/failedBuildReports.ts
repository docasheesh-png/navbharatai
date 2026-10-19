/** Private failed-report API contracts. No credentials or full reports in list rows. */
export interface FailedBuildRow {
  workspaceId: string;
  historyId: string;
  buildId: string | null;
  startedAt: number;
  endedAt: number;
  appLabel: string;
  rootCause: string | null;
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
      typeof r.appLabel === 'string');
}
