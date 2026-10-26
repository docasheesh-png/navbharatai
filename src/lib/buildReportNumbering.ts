/** Chronological ranks within complete retained failed or latest-per-workspace snapshots. */
export const REPORT_NUMBER_FAILURES = [
  'storage_unavailable', 'scan_timeout', 'scan_limit', 'invalid_timestamp', 'snapshot_miss', 'request_failed',
] as const;
export type ReportNumberFailure = typeof REPORT_NUMBER_FAILURES[number];
export interface BuildReportNumbering {
  /** Safe diagnostic code only; never a database error or report payload. */
  reason?: ReportNumberFailure;
  ordinal: number | null;
  total: number | null;
  asOf: number | null;
}
export function isBuildReportNumbering(value: unknown): value is BuildReportNumbering {
  if (!value || typeof value !== 'object') return false;
  const n = value as BuildReportNumbering;
  if (n.reason !== undefined && !REPORT_NUMBER_FAILURES.includes(n.reason)) return false;
  if (n.ordinal === null) return n.total === null && n.asOf === null;
  if (n.reason !== undefined) return false;
  return Number.isSafeInteger(n.ordinal) && n.ordinal! > 0 && Number.isSafeInteger(n.total) &&
    n.total! >= n.ordinal! && typeof n.asOf === 'number' && Number.isFinite(n.asOf) && n.asOf > 0;
}
