/**
 * 🔴 A BUILD THAT STOPPED TALKING IS NOT A BUILD THAT FINISHED (autopsy 121c2431, 2026-09-26).
 *
 * "Make me an app for maintaining stationary items log", Weak tier. The fast lane wrote 9 files and
 * handed over; the architect read them, found the broken imports, made two edits — and then spent one
 * 71-second call writing 26,371 characters of deliberation ("I should delegate… but I must fix
 * StationaryItem first… the rules say never write application code yourself… Plan: 1. …") and ended
 * the turn with `end_turn` and NO tool call. The loop took that as "the model has finished", the
 * readiness gate then proved the opposite (the entry file was still the seeded starter, and an import
 * pointed at a file that did not exist), and the build ended FAILED at 5.4 minutes — with 1,418 seconds
 * of its own budget still unspent. The user had to press "continue" for a second 5.4-minute build.
 *
 * 🔑 THE GAP, named so it is recognised again: the NUDGE (nudgeToBuild.ts) only fires for a run that
 * has called NO tool at all, so a model that works for a while and then stalls in prose sails past it.
 * And the one thing that KNOWS the app is unfinished — the readiness gate — ran only to write the
 * failure message. This module lets its verdict do the job it was already computing: when the gate
 * says "not built" and the model neither declined nor asked the user anything, the model is handed the
 * gate's own findings and told to act, at most twice. After that the build ends exactly as before.
 *
 * 🔒 IT CANNOT OVERRIDE AN ANSWER. The two stand-downs are the nudge's own tests, reused rather than
 * copied: a model that said it cannot build this, or that ended on a question to the user, is left to
 * be read by the user — the asymmetry nudgeToBuild.ts records (overriding an answer has cost a user a
 * working app) holds here too. Kill switch: `AGENTV3_UNFINISHED_RESUME=off`. PURE.
 */
import { turnAskedTheUser, turnDeclined } from './nudgeToBuild';

export const MAX_UNFINISHED_RESUMES = 2;

export function unfinishedResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_UNFINISHED_RESUME ?? '').trim().toLowerCase() !== 'off';
}

export interface UnfinishedResumeInput {
  /** The turn's own text — read for a refusal or a question, never for anything else. */
  text: string;
  /** The readiness gate's blockers, verbatim. Empty ⇒ nothing to resume for. */
  blockers: ReadonlyArray<string>;
  resumesUsed: number;
  maxResumes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface UnfinishedResumeDecision {
  resume: boolean;
  /** The model-facing message; '' when `resume` is false. Never shown to the user. */
  message: string;
  /** Why a possible resume was withheld — for the admin report. */
  standDown?: 'declined' | 'asked-the-user' | 'limit' | 'disabled' | 'no-blockers';
}

const MAX_LISTED = 5;
const MAX_BLOCKER_CHARS = 240;

export function decideUnfinishedResume(input: UnfinishedResumeInput): UnfinishedResumeDecision {
  if (!unfinishedResumeEnabled(input.env)) return { resume: false, message: '', standDown: 'disabled' };
  const blockers = (input.blockers ?? []).map((b) => String(b ?? '').trim()).filter(Boolean);
  if (blockers.length === 0) return { resume: false, message: '', standDown: 'no-blockers' };
  if (input.resumesUsed >= (input.maxResumes ?? MAX_UNFINISHED_RESUMES)) return { resume: false, message: '', standDown: 'limit' };
  // Declined first: it is the stronger claim, the same order the nudge uses.
  if (turnDeclined(input.text)) return { resume: false, message: '', standDown: 'declined' };
  if (turnAskedTheUser(input.text)) return { resume: false, message: '', standDown: 'asked-the-user' };
  const listed = blockers.slice(0, MAX_LISTED).map((b) => `- ${b.length > MAX_BLOCKER_CHARS ? `${b.slice(0, MAX_BLOCKER_CHARS)}…` : b}`);
  const more = blockers.length > MAX_LISTED ? `\n- …and ${blockers.length - MAX_LISTED} more.` : '';
  return {
    resume: true,
    message:
      'You ended your turn, but the app is NOT finished. The platform\'s readiness check found:\n'
      + `${listed.join('\n')}${more}\n\n`
      + 'There is still build time left. Do not describe what you will do next — act with tool calls NOW: '
      + 'hand the fixes to the right specialist with task() (one task per file group, all in this turn), '
      + 'or use the edit tools for files you own, then typecheck. Keep going until the app works. '
      + 'If something genuinely stops you, say what it is in one sentence instead.',
  };
}

/** One sentence for the admin report — never user-facing, so it may name the mechanism. */
export function unfinishedResumeNote(resumeNumber: number, blockerCount: number): string {
  return `The model ended its turn with no tool call while the readiness check still found ${blockerCount} blocker(s), `
    + `so it was handed those blockers and told to continue (resume ${resumeNumber} of ${MAX_UNFINISHED_RESUMES}). `
    + 'Before 2026-09-26 the build ended here as FAILED, with its remaining budget unspent.';
}
