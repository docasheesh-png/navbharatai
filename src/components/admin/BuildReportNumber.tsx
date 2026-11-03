import { isBuildReportNumbering, type BuildReportNumbering, type ReportNumberFailure } from '../../lib/buildReportNumbering';

export type BuildReportNumberKind = 'permanent' | 'chronological' | 'failed-chronological';

const failureText: Record<ReportNumberFailure, string> = {
  storage_unavailable: 'Report storage could not complete numbering. Refresh the report list if it persists.',
  scan_timeout: 'The numbering lookup timed out. Refresh the report list to try again.',
  scan_limit: 'The retained report collection exceeds the safe numbering limit. Administrator investigation is required.',
  invalid_timestamp: 'A retained report has an invalid start time. Its number cannot be confirmed.',
  snapshot_miss: 'This report is not in the current numbering snapshot. Refresh the list to retry.',
  request_failed: 'The number request failed. Check the admin session or connection, then refresh the report list.',
  numbering_pending: 'Older reports are still being numbered for the first time. This report gets its permanent number when that finishes.',
  not_numbered: 'This report has no permanent number yet. It is given one by the next numbering pass.',
};

/** Report number badge. Never substitutes a page index. `kind` is kept for existing callers; every kind is the permanent number. */
export function BuildReportNumber({ numbering }: { numbering?: BuildReportNumbering; kind?: BuildReportNumberKind }) {
  if (numbering === undefined) {
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title="Loading report number">…</span>;
  }
  const valid = isBuildReportNumbering(numbering);
  const known = valid && numbering.ordinal !== null;
  const reason = valid ? numbering.reason : undefined;
  if (known) {
    // Every kind now shows the same permanent number: one per build report, of every outcome.
    const title = `Permanent build report number #${numbering.ordinal} (highest assigned: #${numbering.total}). Given once, when the build started, and never changed. Older numbers come from older builds.`;
    return <span className="shrink-0 text-xs font-semibold tabular-nums text-ink" title={title}>#{numbering.ordinal}</span>;
  }
  const detail = reason ? failureText[reason] : 'Permanent report number unavailable for this row.';
  // Never substitute a page-local index or infer why stored metadata was absent.
  return <span className="shrink-0 text-xs font-semibold tabular-nums text-muted" title={detail}>
    — <span className="font-normal">n/a</span>
    {reason && reason !== 'snapshot_miss' && (
      <span className="block text-[10px] font-normal leading-snug">{detail}</span>
    )}
  </span>;
}
