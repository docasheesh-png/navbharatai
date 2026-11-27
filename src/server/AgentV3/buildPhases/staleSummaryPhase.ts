// BUILD PHASE — THE SUMMARY IS CHECKED AGAINST WHAT THE PLATFORM FOUND AFTER IT (build report #2566; staleSummary.ts).
//
// The route's one call, right before the report is finished and the summary is delivered: if the reply the user is
// about to read predates a still-standing preview/runtime finding or the wall-clock cap, the reply is marked as
// written before the last check, in its own words, and the report records it. Kept out of the handler, which only
// shrinks (Q-3237). Idempotent (a summary already carrying the note is left alone) and never throws.
import { laterEvidence, staleSummaryNote, staleSummaryNoteEnabled, staleSummaryReport, summaryWrittenAt, type DatedReply, type TimelineEntry } from '../staleSummary';

export interface StaleSummaryDiag {
  laterEvidenceInput(): { replies: DatedReply[]; issues: TimelineEntry[]; lastCleanAt: number | null };
  record(issue: { phase: 'readiness'; severity: 'warning'; code: string; message: string; autoResolved: boolean }): void;
}

const NOTE_MARK = 'Written before the last check';

export function withLaterEvidence<T extends { summary: string }>(result: T, diag: StaleSummaryDiag, env: NodeJS.ProcessEnv = process.env): T {
  try {
    if (!staleSummaryNoteEnabled(env) || typeof result?.summary !== 'string' || result.summary.includes(NOTE_MARK)) return result;
    const input = diag.laterEvidenceInput();
    const evidence = laterEvidence({ since: summaryWrittenAt(input.replies, result.summary), issues: input.issues, lastCleanAt: input.lastCleanAt });
    const note = staleSummaryNote(evidence);
    if (!note) return result;
    try { diag.record({ phase: 'readiness', severity: 'warning', code: 'SUMMARY_SUPERSEDED', message: staleSummaryReport(evidence), autoResolved: false }); } catch { /* the report is best-effort */ }
    return { ...result, summary: `${result.summary}${note}` };
  } catch {
    return result;
  }
}
