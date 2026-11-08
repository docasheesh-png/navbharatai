/**
 * Permanent build report numbers (`buildReportRegistry.ts`): one per report, every outcome, never
 * renumbered. `scan_timeout`, `scan_limit` and `snapshot_miss` belonged to the retired rank scan and
 * are no longer produced; they stay in the list so a value already in flight still validates.
 */
export const REPORT_NUMBER_FAILURES = [
  'storage_unavailable', 'scan_timeout', 'scan_limit', 'invalid_timestamp', 'snapshot_miss', 'request_failed',
  'numbering_pending', 'not_numbered',
] as const;
export type ReportNumberFailure = typeof REPORT_NUMBER_FAILURES[number];
export interface BuildReportNumbering {
  /** Safe diagnostic code only; never a database error or report payload. */
  reason?: ReportNumberFailure;
  /** The report's permanent number. */
  ordinal: number | null;
  /** The highest number assigned so far (numbers of expired or erased reports leave gaps). */
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
