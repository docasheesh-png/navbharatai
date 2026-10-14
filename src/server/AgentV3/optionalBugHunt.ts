/**
 * THE DEEP BUG HUNT IS OFFERED, NOT ASSUMED (admin 2026-10-13).
 *
 * Admin, verbatim: *"helper, verifier jo app banne ke bad last me check karta hai, ko optional kar do"* —
 * with a ❓ question button in the chat, "Yes" running the helper that already exists, and "No" meaning
 * the build is complete as it stands.
 *
 * 🔴 WHAT WAS ACTUALLY WRONG, AND IT IS WORSE THAN "NOT OPTIONAL". The post-build reviewer is a
 * multi-call model pass that the user ALREADY PAYS FOR, on every single build, without ever being
 * asked. The size of that is on the record — autopsy b6f88a72, quoted in the route beside the call:
 * *"40 calls, 523,374 input tokens = 34.4% of the build, `responseChars: 0` on every one, and then no
 * verdict at all — all of it billed at ×4"*. A third of a build's bill, for nothing, silently. So this
 * is not a new charge being introduced; it is an existing charge finally being shown to the person
 * paying it. The admin put it plainly: the real build costs x, the helper takes 4x.
 *
 * 🔒 WHAT IS *NOT* TOUCHED, AND WHY THAT IS THE POINT. The deterministic end-of-build checks — the tsc
 * gate, the lint gate, readiness, the playtest, the fake-feature scan, the journeys — spend no model
 * tokens, live in no billing phase, and are the EVIDENCE that the app was built at all. Making those
 * paid would mean a free build only ever yields "it probably works", which the second absolute rule
 * forbids outright. They stay free and they stay automatic. Only the model-driven hunt is offered.
 *
 * 🧬 THE CLASS THIS AVOIDS. A declined hunt must read as NOT RUN, never as PASSED — `playtestNotRunVerdict`'s
 * principle one level up: *a check that was never asked for is not a check that passed.* An app shipped
 * under a green tick that nobody earned is the failure mode the fifth absolute rule exists to kill.
 *
 * Everything here is PURE: no I/O, no clock, no env read except the one explicit kill switch.
 */

import type { ApprovalOutcome } from './Approvals';

/**
 * How long the build waits for the answer before carrying on WITHOUT the hunt.
 *
 * Shorter than the database offer's 120 s on purpose: that question changes how the app is built and is
 * worth holding the build for, while this one is an extra look at an app that is already finished and
 * working. A user who has walked away gets their app, not a stalled build.
 */
export const BUG_HUNT_WAIT_MS = 90_000;

/** Kill switch. `off` restores today's behaviour exactly: the hunt runs, unasked, as it always has. */
export function bugHuntAskEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_BUG_HUNT_ASK ?? '').trim().toLowerCase() !== 'off';
}

export type BugHuntOffer =
  | { ask: true }
  | { ask: false; why: 'no-user' | 'ask-disabled' | 'review-not-eligible' | 'already-asked' };

/**
 * Whether to put the question in front of the user.
 *
 * 🔑 `reviewEligible` IS THE WHOLE GUARD AGAINST ASKING FOR A NO-OP. The reviewer already has a gate
 * (`reviewerShouldRun`) and several further conditions — the build succeeded, there is headroom left,
 * the review is not deferred to a Project Mode shell turn. Asking a user to spend credits on a pass
 * that was never going to run would be a charge for nothing, so this decision is made only once all of
 * that already says yes.
 *
 * An anonymous caller is never asked: there is no wallet to spend from, so the question could not be
 * honoured either way. PURE.
 */
export function bugHuntOfferDecision(input: {
  hasUser: boolean;
  askEnabled: boolean;
  reviewEligible: boolean;
  alreadyAsked: boolean;
}): BugHuntOffer {
  if (!input.reviewEligible) return { ask: false, why: 'review-not-eligible' };
  if (!input.askEnabled) return { ask: false, why: 'ask-disabled' };
  if (!input.hasUser) return { ask: false, why: 'no-user' };
  if (input.alreadyAsked) return { ask: false, why: 'already-asked' };
  return { ask: true };
}

/**
 * Does the hunt run? ONLY on an explicit yes.
 *
 * A timeout, a Stop and a decline are all "no" — and they are the same "no" deliberately. A build that
 * spends the user's credits because nobody answered in ninety seconds has charged them for silence.
 * PURE.
 */
export function bugHuntRuns(answer: ApprovalOutcome): boolean {
  return answer === 'approved';
}

/** What the four outcomes are called in the diagnostics row, so a report can tell them apart. */
export function bugHuntAnswerWords(answer: ApprovalOutcome): string {
  if (answer === 'approved') return 'the user asked for the bug hunt';
  if (answer === 'denied') return 'the user declined the bug hunt';
  if (answer === 'stopped') return 'the build was stopped while the offer was open';
  return 'the offer went unanswered';
}

/**
 * The question itself.
 *
 * 🔴 NO RUPEE FIGURE, AND THAT IS A CORRECTNESS DECISION, NOT A PRESENTATION ONE (admin 2026-10-13).
 * The hunt's cost is metered per token, so no honest number exists before it runs — a figure printed on
 * this button would be a fabricated quote, which `NO_FAKE_FEATURE_RULE` forbids as squarely as a fake
 * login. What the user is owed up front is that it COSTS and WHERE FROM; the exact amount reaches them
 * in the bill, priced by the settle's own function, exactly as today.
 *
 * 🔒 ENGLISH, DELIBERATELY. This is the PLATFORM speaking, not the AI, so `narrationCatalogue.ts`'s
 * rule applies: professional English (CLAUDE.md's Language standard, admin re-stated 2026-08-11). The
 * admin asked for the user's language here, and the reason this does not follow it is the admin's OWN
 * later correction: on 2026-09-14 they found a voice-chat PRICE rendered in Devanagari and asked
 * *"south india wale kaise padhenge isko??"*, which superseded three modules' "user's language"
 * behaviour. A price is the exact artefact of that correction, so translating this one would re-create
 * the thing they stopped. Raised with them rather than done quietly.
 */
export interface BugHuntOfferCopy {
  /** The short bold line. A question, because it is one. */
  title: string;
  /** The detail under it — what it does, that it spends credits, and that the app is already fine. */
  why: string;
  approveLabel: string;
  denyLabel: string;
}

export function bugHuntOfferCopy(): BugHuntOfferCopy {
  return {
    title: 'Find and fix bugs in your app?',
    why: 'A deep review reads your app\'s code, reports the real bugs it finds, and fixes what it can '
      + 'safely fix. It runs an AI engine, so it spends credits from your wallet — free and gift credits '
      + 'count. Your app is already built and working; this is an extra check, not a repair.',
    approveLabel: 'Find and fix bugs',
    denyLabel: 'Not now',
  };
}

/**
 * The line the user sees when the hunt does not run.
 *
 * It says the check was NOT RUN. It must never read as a pass: the app carries no bug-hunt verdict, and
 * saying otherwise would be the fake-success the second absolute rule bans.
 */
export function bugHuntNotRunLine(answer: ApprovalOutcome): string {
  const why = answer === 'denied'
    ? 'You chose not to run the deep bug hunt'
    : answer === 'stopped'
      ? 'The build was stopped before the deep bug hunt was answered'
      : 'The deep bug hunt offer went unanswered';
  return `${why}, so it did not run — your app is built and was not bug-hunted. `
    + 'Ask for it any time and it will run on the app as it stands.';
}

/** The gate's own words, as the `permission_request` event carries them. */
export interface BugHuntGateEvent {
  action: string;
  title: string;
  why: string;
  approveLabel: string;
  denyLabel: string;
  callId: string;
}

/** What the gate decided, and the only thing the route needs back. */
export interface BugHuntResult {
  /** Run the post-build review? TRUE when it was not offered at all, so an un-offered build is unchanged. */
  runReview: boolean;
  /** The answer, when one was asked for. `null` means the question was never put. */
  answer: ApprovalOutcome | null;
}

/**
 * THE WHOLE FLOW, WITH ITS EFFECTS HANDED IN.
 *
 * 🔴 WHY IT LIVES HERE AND NOT IN THE ROUTE. The `/build` handler sits ON TypeScript's control-flow-
 * analysis ceiling (Q-979): the first version of this feature put its `let`, its nested `if`s and its two
 * `try`s inline, and the file stopped type-checking with TS2563 — the feature's own cost, paid by every
 * future change to that handler. Taking `ask` / `wait` / `say` / `record` as arguments keeps the route at
 * one call and makes every branch below unit-testable without a server, a user or a clock.
 *
 * 🔑 THE FAIL-OPEN IS DELIBERATE AND IT IS THE SAFE DIRECTION. If anything here throws, `runReview` is
 * TRUE: the build behaves exactly as it did before this feature existed. The opposite default would let a
 * bug in an offer silently cancel the app's deepest check — a feature that quietly removes a safety net is
 * worse than one that fails loudly.
 */
export async function offerBugHunt(io: {
  /** Every other condition for the review already says yes. FALSE ⇒ nothing is asked and nothing changes. */
  eligible: boolean;
  hasUser: boolean;
  newCallId: () => string;
  ask: (gate: BugHuntGateEvent) => void;
  wait: (callId: string) => Promise<ApprovalOutcome>;
  say: (text: string) => void;
  record: (message: string) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<BugHuntResult> {
  const offer = bugHuntOfferDecision({
    hasUser: io.hasUser,
    askEnabled: bugHuntAskEnabled(io.env ?? process.env),
    reviewEligible: io.eligible,
    alreadyAsked: false, // the offer is scoped to this turn, so the next edit asks again
  });
  if (!offer.ask) return { runReview: io.eligible, answer: null };

  let answer: ApprovalOutcome;
  try {
    const copy = bugHuntOfferCopy();
    const callId = io.newCallId();
    io.ask({
      // The one-string form too, for anything still reading the old shape.
      action: `${copy.title} ${copy.why}`,
      title: copy.title,
      why: copy.why,
      approveLabel: copy.approveLabel,
      denyLabel: copy.denyLabel,
      callId,
    });
    answer = await io.wait(callId);
  } catch {
    return { runReview: true, answer: null };
  }

  if (bugHuntRuns(answer)) return { runReview: true, answer };
  // Offered and not taken: it does not run, and it is reported as NOT RUN — never as passed.
  io.record(`The deep bug hunt was offered and did not run: ${bugHuntAnswerWords(answer)}. The app's own end-of-build checks ran as always.`);
  io.say(bugHuntNotRunLine(answer));
  return { runReview: false, answer };
}
