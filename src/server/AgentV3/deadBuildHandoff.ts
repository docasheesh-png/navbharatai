// THE BUILD AFTER A DEAD ONE IS TOLD WHAT THE DEAD ONE DID (failedbr #2525, Q-3470, 2026-11-26).
//
// 🔴 THE STRUGGLE. Build #2523 died at 164 s (its server was lost) after writing App.tsx and running a typecheck that
// found four errors. The user's "continue" (#2525) began with EIGHT single-file reads in 40 s — App.tsx, GameCanvas,
// Game.ts, player.ts … — flagged EXPLORATION_WITHOUT_CHANGE, to learn what #2523 had done. Everything it re-derived
// was already on record: the dead build's own report lists every write and every command, the typecheck included,
// and the report is saved as the build runs, so it survives the loss of the server.
//
// 🔑 THE CLASS: a build's memory of the previous turn came only from the conversation transcript and the in-process
// workspace memory, and both are lost with the server — exactly the case where the next build needs them most. The
// durable record that DOES survive (the report) was never read back. This reads it: the files the dead build wrote or
// edited, and its last typecheck verbatim, handed to the next build before its first call.
//
// PURE: report in, prompt block out. The loader (DiagnosticsStore.loadDeadBuildHandoffReport) does the one read.

/** The issue code a settled dead build carries (orphanedBuildReport.ts). Re-stated to keep this module dependency-free. */
const ENDED_UNRECORDED = 'BUILD_ENDED_UNRECORDED';

/** A dead build older than this is not "the build the user is continuing"; its files speak for themselves. */
export const DEAD_BUILD_HANDOFF_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_FILES = 25;
const MAX_TSC_LINES = 12;

interface IssueLike { ts?: unknown; code?: unknown; message?: unknown; detail?: unknown }
interface CommandLike { ts?: unknown; command?: unknown; stdout?: unknown; typecheckProof?: unknown }
export interface DeadBuildReportLike {
  startedAt?: unknown;
  endedAt?: unknown;
  ok?: unknown;
  issues?: readonly IssueLike[];
  commands?: readonly CommandLike[];
}

const WRITE_TOOLS = /^▶\s*(write_file|edit_file|write_files_batch|create_file|replace_in_file|apply_patch|delete_file|rename_file)\b/;

/** Did this report's build end without recording its own end? (Settled by a sweep or a later admission, or not yet.) PURE. */
export function buildEndedUnrecorded(report: DeadBuildReportLike | null | undefined): boolean {
  if (!report || typeof report.startedAt !== 'number') return false;
  const issues = Array.isArray(report.issues) ? report.issues : [];
  if (issues.some((i) => i?.code === ENDED_UNRECORDED)) return true;
  return typeof report.endedAt !== 'number';
}

/** The paths the dead build wrote or edited, in the order it touched them, each once. PURE. */
export function deadBuildWrites(report: DeadBuildReportLike): string[] {
  const out: string[] = [];
  for (const i of Array.isArray(report.issues) ? report.issues : []) {
    if (i?.code !== 'TOOL_CALL' || typeof i.message !== 'string' || !WRITE_TOOLS.test(i.message)) continue;
    const detail = typeof i.detail === 'string' ? i.detail : '';
    const path = detail.split('·').slice(1).join('·').trim();
    if (path && !/\s/.test(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** The dead build's last typecheck output (the platform's or the model's own `tsc --noEmit`), or null. PURE. */
export function deadBuildLastTypecheck(report: DeadBuildReportLike): { stdout: string; ts: number | null } | null {
  const cmds = Array.isArray(report.commands) ? report.commands : [];
  for (let k = cmds.length - 1; k >= 0; k--) {
    const c = cmds[k];
    const isTsc = !!c?.typecheckProof || (typeof c?.command === 'string' && /\btsc\b[^|;&]*--noEmit/.test(c.command));
    if (!isTsc) continue;
    return { stdout: typeof c.stdout === 'string' ? c.stdout : '', ts: typeof c.ts === 'number' ? c.ts : null };
  }
  return null;
}

/**
 * The block handed to the next build, or '' when the previous build ended on its own, is too old, or did nothing worth
 * handing over. Never says more than the report proves. PURE.
 */
export function deadBuildHandoff(report: DeadBuildReportLike | null | undefined, opts: { nowMs: number }): string {
  if (!report || !buildEndedUnrecorded(report)) return '';
  const startedAt = report.startedAt as number;
  if (!(opts.nowMs - startedAt >= 0 && opts.nowMs - startedAt <= DEAD_BUILD_HANDOFF_MAX_AGE_MS)) return '';
  const writes = deadBuildWrites(report);
  const tsc = deadBuildLastTypecheck(report);
  if (writes.length === 0 && !tsc) return '';
  const lines: string[] = ['[THE PREVIOUS BUILD OF THIS APP WAS CUT OFF — this is what it had done, from its saved report]'];
  lines.push('It stopped before finishing (the server running it was lost); its writes were saved as it went.');
  if (writes.length) {
    const shown = writes.slice(0, MAX_FILES);
    lines.push(`Files it wrote or edited (${writes.length}; a later command of it may have changed or removed one): ${shown.join(', ')}${writes.length > shown.length ? `, …and ${writes.length - shown.length} more` : ''}.`);
  }
  if (tsc) {
    const errs = tsc.stdout.split('\n').filter((l) => /error TS\d+/.test(l));
    if (errs.length === 0 && tsc.stdout.trim() === '') lines.push('Its last typecheck printed nothing (clean at that moment).');
    else if (errs.length) {
      lines.push(`Its last typecheck found ${errs.length} error(s)${errs.length > MAX_TSC_LINES ? ` (first ${MAX_TSC_LINES})` : ''} — they may still be there:`);
      lines.push(...errs.slice(0, MAX_TSC_LINES).map((l) => l.trim().slice(0, 300)));
    }
  }
  lines.push('Continue from this point. Read a file only when you need its exact content for the next change — do not re-read the project to rediscover what is listed here.');
  return lines.join('\n');
}
