/**
 * 🔴 A SCREEN WITH UNSTYLED CLASSES IS NOT FINISHED (autopsy a106df77, 2026-10-01 — the fourth report of
 * one class, after 466c260a, 1389f0d5 and 12c642ed).
 *
 * The write-time notes worked as designed: every screen the builder wrote came back with "these classes
 * have no style rule — add them to src/index.css now". The builder deferred each one, ended its turn with
 * fourteen classes undefined, and the end-of-build design pass then spent a fresh-context model run
 * (183 s of post-answer work in that report) adding the rules the builder had been told about five times.
 * A note that can be deferred until a heal pays for it is a heal with extra steps.
 *
 * So the runner asks the question once more when the model says it is done: if any screen still uses a
 * class nothing defines, the model gets the list and one more turn, in the context that wrote those
 * screens. At most once per build, and never after a refusal or a question to the user (the nudge's own
 * tests, reused). If classes remain after that, the end-of-build check and its repair run as before.
 * Kill switch: AGENTV3_UNSTYLED_RESUME=off. PURE.
 */
import { turnAskedTheUser, turnDeclined } from './nudgeToBuild';

export const MAX_UNSTYLED_RESUMES = 1;

export function unstyledResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_UNSTYLED_RESUME ?? '').trim().toLowerCase() !== 'off';
}

export function decideUnstyledResume(input: { text: string; note: string; resumesUsed: number; env?: NodeJS.ProcessEnv }): { resume: boolean; message: string } {
  const note = String(input.note ?? '').trim();
  if (!unstyledResumeEnabled(input.env) || !note || input.resumesUsed >= MAX_UNSTYLED_RESUMES) return { resume: false, message: '' };
  if (turnDeclined(input.text) || turnAskedTheUser(input.text)) return { resume: false, message: '' };
  return {
    resume: true,
    message: 'Before you finish: these screens still use classes that no stylesheet defines, so those parts render unstyled.\n'
      + `${note.slice(0, 3000)}\n`
      + 'Add the missing rules to the stylesheet in one edit (or switch to the class named beside each one), then end your turn. '
      + 'Do not rewrite the stylesheet and do not change anything else.',
  };
}
