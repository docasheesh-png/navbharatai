import { isFailedBuildPage, type FailedBuildPage, type FailedBuildRow } from './failedBuildReports';

export const FAILED_REPORTS_REFRESH_MS = 60_000;
export type FailedReportRequest = (url: string, init?: RequestInit) => Promise<unknown>;

/** Date order belongs to the complete retained cohort, never to one workspace batch. */
export function newestFailedReports(rows: Iterable<FailedBuildRow>): FailedBuildRow[] {
  const unique = new Map<string, FailedBuildRow>();
  for (const row of rows) {
    // A latest-only legacy row can gain a history row during a moving traversal.
    const key = JSON.stringify([row.workspaceId, row.startedAt]);
    const previous = unique.get(key);
    if (!previous || row.historyId !== 'latest') unique.set(key, row);
  }
  // The permanent report number first (the highest is the newest build — the same order the plugin lists), then the
  // start time, which decides alone while numbering is still pending.
  return [...unique.values()].sort((a, b) => (b.permanentReportId ?? 0) - (a.permanentReportId ?? 0) || b.startedAt - a.startedAt ||
    (a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0) ||
    (a.historyId < b.historyId ? -1 : a.historyId > b.historyId ? 1 : 0));
}

/** Always restart at the beginning so newly inserted workspaces cannot hide behind an old cursor. */
export async function loadFailedBuildReports(
  request: FailedReportRequest,
  signal: AbortSignal,
  onProgress: (page: FailedBuildPage) => void = () => {},
): Promise<FailedBuildPage> {
  let cursor: string | null = null;
  let scanned = 0;
  const rows: FailedBuildRow[] = [];
  const seen = new Set<string>();
  for (;;) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const data = await request(`/api/v1/failedbr/reports?${query}`, { signal });
    signal.throwIfAborted();
    if (!isFailedBuildPage(data)) throw new Error('The server returned an unreadable report list.');
    rows.push(...data.reports);
    scanned += data.scanned;
    const page = { ...data, reports: newestFailedReports(rows), scanned };
    onProgress(page);
    if (data.nextCursor === null) return page;
    if (seen.has(data.nextCursor)) throw new Error('Report loading did not advance. Please refresh to try again.');
    seen.add(data.nextCursor);
    cursor = data.nextCursor;
  }
}
