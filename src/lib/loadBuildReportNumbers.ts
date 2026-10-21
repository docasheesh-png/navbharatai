import { adminHeaders } from './adminFetch';
import { isBuildReportNumbering, type BuildReportNumbering } from './buildReportNumbering';

export interface NumberedReportReference {
  workspaceId: string;
  startedAt?: number;
  id?: string;
  historyId?: string;
  numbering?: BuildReportNumbering;
}
const keyOf = (row: NumberedReportReference) => JSON.stringify([row.workspaceId, row.historyId ?? row.id, row.startedAt]);
export function unavailableReportNumbers<T extends NumberedReportReference>(rows: readonly T[]): T[] {
  return rows.map(row => ({ ...row, numbering: { ordinal: null, total: null, asOf: null } }));
}
/** One metadata-only request, independent of the list request. No polling or full-report reread. */
export async function loadBuildReportNumbers<T extends NumberedReportReference>(
  cohort: 'latest' | 'failed', rows: readonly T[], token: string, signal: AbortSignal,
): Promise<T[]> {
  if (!rows.length) return [];
  const reports = rows.filter(row => typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) && row.startedAt > 0)
    .map(row => ({ workspaceId: row.workspaceId, historyId: row.historyId ?? row.id, startedAt: row.startedAt }));
  if (!reports.length) return unavailableReportNumbers(rows);
  const response = await fetch(cohort === 'latest' ? '/api/v1/admin/all-builds/numbers' : '/api/v1/failedbr/report-numbers', {
    method: 'POST', cache: 'no-store', signal,
    headers: { ...adminHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ reports }),
  });
  if (!response.ok) throw new Error('Chronological report numbers are unavailable.');
  const data: unknown = await response.json();
  const numbers = (data as { numbers?: unknown } | null)?.numbers;
  if (!Array.isArray(numbers) || numbers.length > reports.length || !numbers.every(row => row &&
    typeof row.workspaceId === 'string' && typeof row.historyId === 'string' &&
    typeof row.startedAt === 'number' && Number.isFinite(row.startedAt) && isBuildReportNumbering(row.numbering))) {
    throw new Error('Unreadable report numbering.');
  }
  const requested = new Set(reports.map(keyOf));
  const byKey = new Map<string, BuildReportNumbering>();
  for (const row of numbers) {
    const key = keyOf(row);
    if (!requested.has(key) || byKey.has(key)) throw new Error('Mismatched report numbering.');
    byKey.set(key, row.numbering);
  }
  return rows.map(row => ({ ...row, numbering: byKey.get(keyOf(row)) ?? { ordinal: null, total: null, asOf: null } }));
}
