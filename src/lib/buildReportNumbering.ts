/** A position in a retained cohort snapshot, never a permanent report identifier. */
export interface BuildReportNumbering {
  ordinal: number | null;
  total: number | null;
  asOf: number | null;
}
export function isBuildReportNumbering(value: unknown): value is BuildReportNumbering {
  if (!value || typeof value !== 'object') return false;
  const n = value as BuildReportNumbering;
  if (n.ordinal === null) return n.total === null && n.asOf === null;
  return Number.isSafeInteger(n.ordinal) && n.ordinal! > 0 && Number.isSafeInteger(n.total) &&
    n.total! >= n.ordinal! && typeof n.asOf === 'number' && Number.isFinite(n.asOf) && n.asOf > 0;
}
