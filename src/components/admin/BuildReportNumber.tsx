import { isBuildReportNumbering, type BuildReportNumbering, type ReportNumberFailure } from '../../lib/buildReportNumbering';

export type BuildReportNumberKind = 'permanent' | 'chronological' | 'failed-chronological';

const failureText: Record<ReportNumberFailure, string> = {
  storage_unavailable: 'Report storage could not complete numbering. Refresh the report list if it persists.',
  scan_timeout: 'The numbering lookup timed out. Refresh the report list to try again.',
  scan_limit: 'The retained report collection exceeds the safe numbering limit. Administrator investigation is required.',
  invalid_timestamp: 'A retained report has an invalid start time. Its number cannot be confirmed.',
  snapshot_miss: 'This report is not in the current numbering snapshot. Refresh the list to retry.',
  request_failed: 'The number request failed. Check the admin session or connection, then refresh the report list.',
};

const chronologicalMiss = 'This chronological rank is not in the current numbering snapshot. Refresh the list to retry.';

/** Report number badge. Never substitutes a page index. kind identifies the complete cohort or the separate permanent reference. */
export function BuildReportNumber({ numbering, kind = 'permanent' }: { numbering?: BuildReportNumbering; kind?: BuildReportNumberKind }) {
  if (numbering === undefined) {
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title="Loading report number">…</span>;
  }
  const valid = isBuildReportNumbering(numbering);
  const known = valid && numbering.ordinal !== null;
  const reason = valid ? numbering.reason : undefined;
  if (known) {
    const title = kind !== 'permanent'
      ? `Chronological rank #${numbering.ordinal} of ${numbering.total} retained ${kind === 'failed-chronological' ? 'failed' : 'latest-per-workspace'} reports as of ${new Date(numbering.asOf!).toLocaleString()}. Oldest is 1. Retention or late-arriving reports can change these ranks.`
      : `Permanent failed-report number #${numbering.ordinal} (of ${numbering.total} assigned). Assigned once when the failure was retained; never renumbered. Allocation order is not build chronology.`;
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-ink" title={title}>#{numbering.ordinal}</span>;
  }
  const detail = reason
    ? (kind !== 'permanent' && reason === 'snapshot_miss' ? chronologicalMiss : failureText[reason])
    : (kind !== 'permanent' ? 'Chronological rank unavailable for this row.' : 'Permanent report number unavailable for this row.');
  // Never substitute a page-local index or infer why stored metadata was absent.
  return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title={detail}>
    — <span className="font-normal">n/a</span>
    {reason && reason !== 'snapshot_miss' && (
      <span className="block text-[10px] font-normal leading-snug">{detail}</span>
    )}
  </span>;
}
