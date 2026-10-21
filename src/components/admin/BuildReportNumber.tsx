import { isBuildReportNumbering, type BuildReportNumbering } from '../../lib/buildReportNumbering';

/** Never substitute a page index for an unavailable chronological rank. */
export function BuildReportNumber({ numbering }: { numbering?: BuildReportNumbering }) {
  if (numbering === undefined) return <span className="shrink-0 text-xs font-semibold text-muted">Number loading…</span>;
  const known = isBuildReportNumbering(numbering) && numbering.ordinal !== null;
  return <span className="shrink-0 text-xs font-semibold text-muted" title={known
    ? `Number ${numbering.ordinal} of ${numbering.total} retained reports as of ${new Date(numbering.asOf!).toLocaleString()}. Oldest is 1. This is not a permanent report ID.`
    : 'Chronological number unavailable: the complete retained cohort could not be established, or this report is newer than its snapshot.'}>
    {known ? `#${numbering.ordinal}` : 'Number unavailable'}
  </span>;
}
