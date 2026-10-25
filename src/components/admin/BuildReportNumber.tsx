import { isBuildReportNumbering, type BuildReportNumbering, type ReportNumberFailure } from '../../lib/buildReportNumbering';

const failureText: Record<ReportNumberFailure, string> = {
  storage_unavailable: 'Report storage could not complete numbering. Refresh the report list if it persists.',
  scan_timeout: 'The numbering lookup timed out. Refresh the report list to try again.',
  scan_limit: 'The retained report collection exceeds the safe numbering limit. Administrator investigation is required.',
  invalid_timestamp: 'A retained report has an invalid start time. Its permanent number cannot be confirmed.',
  snapshot_miss: 'This report has no permanent number yet (legacy rows written before numbering). New failures receive the next number automatically.',
  request_failed: 'The number request failed. Check the admin session or connection, then refresh the report list.',
};
/** Permanent failed-report number when present. Never substitutes a page index. */
export function BuildReportNumber({ numbering }: { numbering?: BuildReportNumbering }) {
  if (numbering === undefined) return <span className="shrink-0 text-xs font-semibold text-muted">Number loading…</span>;
  const valid = isBuildReportNumbering(numbering);
  const known = valid && numbering.ordinal !== null;
  const reason = valid ? numbering.reason : undefined;
  return <span className="shrink-0 text-xs font-semibold text-muted" title={known
    ? `Permanent failed-report number #${numbering.ordinal} (of ${numbering.total} assigned). Assigned once when the failure was retained; never renumbered. Higher numbers are newer.`
    : (reason ? failureText[reason] : 'Permanent report number unavailable for this row.')}>
    {known ? `#${numbering.ordinal}` : 'Number unavailable'}
    {!known && reason && <span className="block text-xs font-normal">{failureText[reason]}</span>}
  </span>;
}
