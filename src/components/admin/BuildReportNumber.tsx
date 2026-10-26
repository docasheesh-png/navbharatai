import { isBuildReportNumbering, type BuildReportNumbering, type ReportNumberFailure } from '../../lib/buildReportNumbering';

export type BuildReportNumberKind = 'permanent' | 'chronological';

const failureText: Record<ReportNumberFailure, string> = {
  storage_unavailable: 'Report storage could not complete numbering. Refresh the report list if it persists.',
  scan_timeout: 'The numbering lookup timed out. Refresh the report list to try again.',
  scan_limit: 'The retained report collection exceeds the safe numbering limit. Administrator investigation is required.',
  invalid_timestamp: 'A retained report has an invalid start time. Its number cannot be confirmed.',
  snapshot_miss: 'No number for this row yet (written before numbering). New failures get the next permanent number automatically.',
  request_failed: 'The number request failed. Check the admin session or connection, then refresh the report list.',
};

const chronologicalMiss = 'This latest-build rank is not in the current numbering snapshot. Refresh the list to retry.';

/** Report number badge. Never substitutes a page index. kind selects copy for permanent failed vs chronological latest ranks. */
export function BuildReportNumber({ numbering, kind = 'permanent' }: { numbering?: BuildReportNumbering; kind?: BuildReportNumberKind }) {
  if (numbering === undefined) {
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title="Loading report number">…</span>;
  }
  const valid = isBuildReportNumbering(numbering);
  const known = valid && numbering.ordinal !== null;
  const reason = valid ? numbering.reason : undefined;
  if (known) {
    const title = kind === 'chronological'
      ? `Chronological rank #${numbering.ordinal} of ${numbering.total} retained latest-per-workspace reports as of ${new Date(numbering.asOf!).toLocaleString()}. Oldest is 1. Retention can change these ranks.`
      : `Permanent failed-report number #${numbering.ordinal} (of ${numbering.total} assigned). Assigned once when the failure was retained; never renumbered. Higher numbers are newer.`;
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-ink" title={title}>#{numbering.ordinal}</span>;
  }
  const detail = reason
    ? (kind === 'chronological' && reason === 'snapshot_miss' ? chronologicalMiss : failureText[reason])
    : (kind === 'chronological' ? 'Chronological rank unavailable for this row.' : 'Permanent report number unavailable for this row.');
  // Compact "—" / n/a so legacy rows prove numbering UI is live without looking broken.
  return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title={detail}>
    — <span className="font-normal">n/a</span>
    {reason === 'snapshot_miss' && kind === 'permanent' && (
      <span className="block text-[10px] font-normal leading-snug">Legacy · new failures get #N</span>
    )}
    {reason && reason !== 'snapshot_miss' && (
      <span className="block text-[10px] font-normal leading-snug">{detail}</span>
    )}
  </span>;
}
