// AgentV3 — admin build-report triage: has this report been sent for fixing, and has it been fixed?
//
// ADMIN REQUEST 2026-08-12: "jab admin koi build report download kar le, to build report par koi tag
// lag jaye jisse admin ko pata rahe, is build report ki fix kiya ja chuka hai."
//
// The need is real: reports arrive faster than they are fixed, and without a mark the admin re-reads
// (or re-sends) the same one. But "downloaded" and "fixed" are NOT the same fact, and collapsing them
// would make the dashboard lie in the most ordinary case there is.
//
// The proof is this very session. The admin downloaded ONE report on 2026-08-12; fixing what was in it
// took TEN merged pull requests over several hours. Under a one-state design that report would have
// read "fixed" from the first minute — while nine of its ten defects were still shipping. A dashboard
// that says a thing is done before it is done is worse than no dashboard, because the admin stops
// checking the ones it has already ticked.
//
// So: two marks, each true on its own terms.
//   SENT  — set the moment the report is downloaded. A fact about the admin's action.
//   FIXED — set explicitly, by a person, when the work is actually done. A fact about the work.
//
// Both are PURE decisions here so the meaning of each badge is test-locked and cannot drift between the
// server that stores it and the panel that renders it.

/** The triage marks carried on an admin build-report row. All optional — a legacy row has none. */
export interface ReportTriage {
  /** When the admin downloaded this report (ms). Set automatically on download. */
  downloadedAt?: number | null;
  /** When a person marked the work genuinely finished (ms). Never set automatically. */
  fixedAt?: number | null;
  /** Optional free-text the admin attached when marking it fixed (e.g. a PR number). */
  fixedNote?: string | null;
}

export type ReportStatus = 'new' | 'sent' | 'fixed';

const ts = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/**
 * The single status of a report. PURE.
 *
 * FIXED outranks SENT: a report can only be fixed after it was looked at, and if a legacy row somehow
 * carries `fixedAt` without `downloadedAt`, the finished state is still the truthful one to show.
 */
export function reportStatus(t: ReportTriage | null | undefined): ReportStatus {
  if (ts(t?.fixedAt)) return 'fixed';
  if (ts(t?.downloadedAt)) return 'sent';
  return 'new';
}

/** The badge the admin list renders. Short — it sits in a dense row. PURE. */
export function reportStatusLabel(status: ReportStatus): string {
  switch (status) {
    case 'fixed': return '✅ Fixed';
    // NOT "in progress": we know the report was downloaded, we do NOT know anyone is working on it.
    // The badge says what happened, not what we hope is happening.
    case 'sent': return '📤 Downloaded';
    default: return '🆕 New';
  }
}

/** One line of hover/detail text spelling out what the badge actually claims. PURE. */
export function reportStatusHint(t: ReportTriage | null | undefined, fmt: (ms: number) => string): string {
  const fixed = ts(t?.fixedAt);
  const sent = ts(t?.downloadedAt);
  if (fixed) {
    const note = (t?.fixedNote ?? '').trim();
    return `Marked fixed on ${fmt(fixed)}${note ? ` — ${note}` : ''}`;
  }
  if (sent) return `Downloaded on ${fmt(sent)} — not marked fixed yet`;
  return 'Not downloaded yet';
}

/**
 * Merge an incoming mark onto a report's existing triage. PURE, and deliberately narrow.
 *
 * Rules, each of which exists to stop the marks from lying:
 *  - DOWNLOAD IS STICKY. The first download is the one that matters ("when did this leave my inbox");
 *    re-downloading a report later must not rewrite that history.
 *  - FIXED IS EXPLICIT AND REVERSIBLE. Only `fixed: true` sets it, and `fixed: false` clears it —
 *    because the admin WILL tick one by mistake, and a mark that cannot be undone is a mark that
 *    silently hides a real bug forever.
 *  - MARKING FIXED IMPLIES IT WAS SEEN. A report fixed without a recorded download gets one, so the
 *    two fields can never disagree about the order they must have happened in.
 *  - A NOTE NEVER SURVIVES ITS MARK. Clearing `fixed` clears the note with it; a note explaining a fix
 *    that is no longer claimed is exactly the kind of stale text that misleads later.
 */
export function applyReportMark(
  current: ReportTriage | null | undefined,
  mark: { downloaded?: boolean; fixed?: boolean; note?: string | null },
  now: number,
): ReportTriage {
  const at = ts(now) ?? Date.now();
  const next: ReportTriage = {
    downloadedAt: ts(current?.downloadedAt),
    fixedAt: ts(current?.fixedAt),
    fixedNote: (current?.fixedNote ?? null) || null,
  };
  if (mark?.downloaded && !next.downloadedAt) next.downloadedAt = at;
  if (mark?.fixed === true) {
    if (!next.fixedAt) next.fixedAt = at;
    if (!next.downloadedAt) next.downloadedAt = at;
    const note = typeof mark.note === 'string' ? mark.note.trim().slice(0, 300) : '';
    if (note) next.fixedNote = note;
  } else if (mark?.fixed === false) {
    next.fixedAt = null;
    next.fixedNote = null;
  }
  return next;
}

/** How many of a list of reports are still waiting — the number worth showing on the tab. PURE. */
export function openReportCount(rows: ReadonlyArray<ReportTriage | null | undefined>): number {
  return (rows ?? []).filter((r) => reportStatus(r) !== 'fixed').length;
}
