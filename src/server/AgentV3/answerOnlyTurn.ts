// A TURN THAT ONLY ANSWERS IS NOT A FAILED BUILD (build d62bf22d, 2026-10-17).
//
// 🔴 WHAT HAPPENED. The user imported a GitHub project and wrote "give me a short survey … Do not change any
// files yet". Nothing was built and nothing was meant to be. The platform still ran its build verdicts over
// the imported app, one doubtful preview line became an ERROR (`OUTCOME_PREVIEW_FAILED`), the release gate
// went RED with a "build-breaking" blocker, the verdict was flipped to ok:false, and the user's survey ended
// with *"Your app is built and saved, but 1 thing is still broken, so it is NOT ready to use yet … Reply
// 'fix it'"* — about an app we were told not to touch, and that was running.
//
// 🔑 THE RULE. On a turn that was not asked to produce anything (`expectsArtifacts` false: an import/survey
// turn) AND did not write a file, the release gate DESCRIBES the app; it does not judge a build, because there
// is no build. The findings stay in the report, exactly as observed. What changes:
//   • a preview that did not render is a WARNING about their app, not an ERROR in our run;
//   • the gate's record is informational and closed — nobody owes a fix for a turn that changed nothing;
//   • the RED → ok:false flip does not fire, so the answer is delivered as the answer, and the turn is
//     billed by the SAME existing rules as any other successful answer turn (no new price, no new waiver).
//
// A turn that wrote even one file is a change and is judged exactly as before. PURE.

import { answeredWithoutBuilding, type TurnAnswer } from './turnAnswer';

export interface AnswerOnlyFacts {
  /** The route's own `expectsArtifacts`: was this turn asked to build or edit? */
  expectsArtifacts: boolean;
  /** Files the builder itself wrote this turn (`builderWroteCount()`). */
  builderWrote: number;
}

/** True when this turn only answered: it was not asked to produce files, and it produced none. */
export function isAnswerOnlyTurn(f: AnswerOnlyFacts): boolean {
  return f.expectsArtifacts !== true && Number(f.builderWrote) === 0;
}

/** Severity of the "preview did not render" outcome: an error only when a build was owed. */
export function previewFailedSeverity(answerOnly: boolean): 'warning' | 'error' {
  return answerOnly ? 'warning' : 'error';
}

/** The gate record on an answer-only turn: informational, closed. */
export function answerOnlyGateRecord(): { severity: 'info'; autoResolved: true } {
  return { severity: 'info', autoResolved: true };
}

/** The admin line saying why the gate did not decide this turn's verdict. */
export const ANSWER_ONLY_GATE_CODE = 'RELEASE_GATE_INFORMATIONAL' as const;

export function answerOnlyGateNote(gateState: string): { phase: 'readiness'; severity: 'info'; code: typeof ANSWER_ONLY_GATE_CODE; message: string; autoResolved: true } {
  return {
    phase: 'readiness', severity: 'info', code: ANSWER_ONLY_GATE_CODE, autoResolved: true,
    message: `Answer-only turn (nothing was asked to be built, no file was written): the release gate (${String(gateState).toUpperCase()}) `
      + 'describes the existing app and did not decide this turn\'s verdict.',
  };
}

/** What the user is told when the preview did not render after the heal budget: the build message is kept as it was. */
export function previewFailedNarration(answerOnly: boolean, problems: readonly string[]): string {
  return answerOnly
    ? answerOnlyPreviewNarration(problems)
    : `⚠️ I checked the live preview and it did not fully render: ${problems.slice(0, 3).join('; ')}. Your files are saved — send a follow-up and I'll fix it.`;
}

/**
 * The answer-only override for the gate's record, spread AFTER the ordinary `releaseGateRecord` (so a build's
 * record is untouched: `{}`), and the informational admin line recorded when it applies. Never throws.
 */
export function decideAnswerOnlyGate(
  answerOnly: boolean,
  gateState: string,
  diag?: { record(r: ReturnType<typeof answerOnlyGateNote>): unknown },
): { answerOnly: boolean; record: { severity?: 'info'; autoResolved?: true } } {
  if (!answerOnly) return { answerOnly: false, record: {} };
  try { diag?.record(answerOnlyGateNote(gateState)); } catch { /* an advisory line never affects a build */ }
  return { answerOnly: true, record: answerOnlyGateRecord() };
}

/** What the user is told when the preview of an app we did not change did not fully render. */
export function answerOnlyPreviewNarration(problems: readonly string[]): string {
  const what = problems.slice(0, 2).join('; ');
  return `ℹ️ I opened your app's preview and it did not fully render${what ? ` (${what})` : ''}. I have not changed any files. Tell me if you want me to look into it.`;
}

/**
 * 🔴 A BUILD TURN WHOSE WHOLE OUTPUT WAS A QUESTION OR A DECLINE (r6–r10 autopsy, owner 2026-10-18).
 *
 * `isAnswerOnlyTurn` needs `expectsArtifacts === false`, so a turn that WAS asked to build, wrote nothing, and
 * answered with a question (`readTurnAnswer().asked`) or an honest decline (`.declined`) was judged as a build:
 * the gate filed RED as an ERROR, the platform started the starter preview to "check it runs", and the free-tier
 * block could read provider noise as "engine slow". It is an answer, and is described like one. The bill is
 * untouched (₹0: the empty-build rule zeroes every build that wrote nothing). PURE.
 * AGENTV3_ANSWER_TURN_NOT_BUILD=off restores the old judgement.
 */
export function answeredInsteadOfBuilding(
  f: { builderWrote: number } & Partial<TurnAnswer>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (String(env.AGENTV3_ANSWER_TURN_NOT_BUILD ?? '').trim().toLowerCase() === 'off') return false;
  // The APK flow and third-party capability boundary are already final answers to the nudge/retry
  // readers. The gate must read the same answer rather than judging that handoff as an empty build.
  return Number(f.builderWrote) === 0 && answeredWithoutBuilding({
    asked: f.asked === true, declined: f.declined === true,
    pointed: f.pointed === true, notOurs: f.notOurs === true,
  });
}
