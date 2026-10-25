import { isBuildReportNumbering, type BuildReportNumbering, type ReportNumberFailure } from '../../lib/buildReportNumbering';

const failureText: Record<ReportNumberFailure, string> = {
  storage_unavailable: 'Report storage could not complete the numbering scan. Refresh the report list if it persists.',
  scan_timeout: 'The complete numbering scan timed out. No partial rank was substituted. Refresh the report list to try again.',
  scan_limit: 'The retained report collection exceeds the safe numbering scan limit. Administrator investigation is required.',
  invalid_timestamp: 'A retained report has an invalid start time. Chronology cannot be established until its metadata is investigated.',
  snapshot_miss: 'This report identity is not present in the cached numbering snapshot. The complete snapshot must refresh before a number can be shown.',
  request_failed: 'The number request failed. Check the admin session or connection, then refresh the report list.',
};
/** Never substitute a page index for an unavailable chronological rank. */
export function BuildReportNumber({ numbering }: { numbering?: BuildReportNumbering }) {
  if (numbering === undefined) return <span className="shrink-0 text-xs font-semibold text-muted">Number loading…</span>;
  const valid = isBuildReportNumbering(numbering);
  const known = valid && numbering.ordinal !== null;
  const reason = valid ? numbering.reason : undefined;
  return <span className="shrink-0 text-xs font-semibold text-muted" title={known
    ? `Number ${numbering.ordinal} of ${numbering.total} retained reports as of ${new Date(numbering.asOf!).toLocaleString()}. Oldest is 1. This is not a permanent report ID.`
    : (reason ? failureText[reason] : 'Chronological number unavailable: the complete retained cohort could not be established, or this report is newer than its snapshot.')}>
    {known ? `#${numbering.ordinal}` : 'Number unavailable'}
    {!known && reason && <span className="block text-xs font-normal">{failureText[reason]}</span>}
  </span>;
}
