// AgentV3 — DID THE BUILD ACTUALLY WORK? ASK THE USER'S BEHAVIOUR, NOT THE USER.
//
// THE ADMIN'S GOAL (2026-08-23): know whether a finished app is really complete, and get the build
// report for the bad ones automatically instead of waiting for somebody to press "Report".
//
// THEIR FIRST INSTINCT WAS A 1-5 STAR POPUP. It was rejected for reasons worth keeping written down,
// because a later session will be tempted by it again:
//   • A star carries no diagnostic content. "3 stars" tells us nothing to fix. What makes the engine
//     stronger is the build REPORT; the rating would only ever be the trigger that fetches it.
//   • Rating fatigue is not hypothetical. Asked after every build, people dismiss it reflexively
//     within a week — and then the 1-2 star tail dries up too, leaving us with silence that reads
//     exactly like success. A quality signal that degrades into false good news is worse than none.
//   • It interrupts the user at the one moment they are most engaged with what they just made.
//
// SO THIS ASKS NOTHING. Every signal below is something the person does anyway, and each one is a fact
// rather than an opinion:
//   • they told us themselves, in their next message ("kaam nahi kar raha", "blank", "error")
//   • they reached for Diagnose or Restart — nobody does that to an app that works
//   • they PUBLISHED it, built an APK, or connected a domain — the strongest evidence an app is good
//     that exists anywhere in this product, because it costs the user something
//   • how long they actually watched their app run (the preview keep-alive, #2597)
//
// THE ONE CASE THIS EXISTS FOR: **the build said it worked and the user's behaviour says it did not.**
// A build that failed openly is already in diagnostics and already known; auto-reporting those would
// bury the admin in things they can see. The valuable, currently-invisible case is the SILENT failure
// — green verdict, unhappy user — and that is the only thing that triggers a report.
//
// THE HONESTY RULE THAT SHAPES EVERYTHING HERE: **absence of evidence is 'unclear', never 'bad'.** A
// user who builds an app and closes the tab has told us nothing. Scoring that as a failure would fill
// the admin's inbox with noise and — far worse — would make our own quality numbers a fiction. This
// codebase has spent the month removing exactly that mistake, in which an artifact stands in for its
// validity. Silence is silence.
//
// PURE — no clock, no I/O. Every input is passed in.

/** Everything we can observe about what happened AFTER a build finished. */
export interface OutcomeSignals {
  /** Did the build itself claim success? Only a claimed success can be a SILENT failure. */
  buildOk: boolean;
  /** The user's next message said the app does not work. null = they have not said anything yet. */
  complained: boolean | null;
  /** They pressed Diagnose or Restart on the preview. */
  askedForRepair: boolean;
  /** They published, built an APK, or connected a domain. */
  invested: boolean;
  /** How long the preview was genuinely watched, in ms. null = never measured. */
  previewWatchedMs: number | null;
}

export type OutcomeVerdict = 'good' | 'unclear' | 'bad';

export interface OutcomeJudgement {
  verdict: OutcomeVerdict;
  /** Short, human, admin-facing reasons — the evidence, never a score with no story behind it. */
  reasons: string[];
}

/**
 * Watching an app for this long, without complaining, is real evidence it works.
 *
 * Two minutes is the admin's own instinct ("user 1-2 minute use kare") and it is a defensible floor:
 * long enough that somebody has clicked past the first screen, short enough that a genuinely good app
 * clears it routinely.
 */
export const GOOD_DWELL_MS = 2 * 60_000;

/**
 * Words a person uses when their app is broken — English and the Hinglish this product's users
 * actually type.
 *
 * DELIBERATELY NARROW, and this is the important judgement. "Add a dark mode" is not a complaint;
 * neither is "change the button colour". Only phrases that assert the app does not WORK count, because
 * a false positive here sends the admin a report about a perfectly good build and teaches them to stop
 * reading reports. Missing a complaint costs one unreported build; crying wolf costs the whole channel.
 */
const COMPLAINT_PATTERNS: readonly RegExp[] = [
  /\bnot working\b/i,
  /\bdoesn'?t work\b/i,
  /\bnothing (?:happens|works|is showing)\b/i,
  /\bblank (?:page|screen)\b/i,
  /\bwhite screen\b/i,
  /\b(?:page|app|preview) (?:is )?(?:broken|crashed|crashing)\b/i,
  /\bshows? an? error\b/i,
  /\bkaam nahi kar\w*\b/i,
  /\bchal nahi rah\w*\b/i,
  /\bkuch nahi ho rah\w*\b/i,
  /\bkhali\b.*\b(?:page|screen|aa rah\w*)\b/i,
  /\btut gay\w*\b/i,
  /\bband ho gay\w*\b/i,
  /\berror aa rah\w*\b/i,
];

/**
 * Does this message assert the app does not work? Pure.
 *
 * Returns false for an empty or absent message — "they have not said anything" is handled by the
 * caller as `complained: null`, which is a different fact from "they said it is fine".
 */
export function complaintInText(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return COMPLAINT_PATTERNS.some((re) => re.test(t));
}

/**
 * Judge what happened after the build. Pure.
 *
 * Order matters and encodes the confidence of each signal: what the user SAID beats what they DID,
 * what they invested in beats how long they looked, and how long they looked beats nothing at all.
 */
export function scoreBuildOutcome(s: OutcomeSignals): OutcomeJudgement {
  const reasons: string[] = [];

  // INVESTMENT FIRST, and it is unconditional. Somebody who published their app, shipped an APK or
  // pointed a domain at it has voted with real effort. Even if they later grumble, the build produced
  // something worth keeping — and treating that as a failure would be the clearest possible false alarm.
  if (s.invested) {
    return { verdict: 'good', reasons: ['the user published, packaged or connected a domain to this app'] };
  }

  if (s.complained === true) reasons.push('the user’s next message said the app does not work');
  if (s.askedForRepair) reasons.push('the user reached for Diagnose or Restart');

  if (reasons.length > 0) {
    // A build that ALREADY reported failure is not a silent one — the admin can see it in diagnostics
    // and does not need it pushed at them. The whole point is catching a green verdict the user
    // contradicts.
    return { verdict: s.buildOk ? 'bad' : 'unclear', reasons: s.buildOk ? reasons : [...reasons, 'the build had already reported failure, so this is not a silent one'] };
  }

  if (typeof s.previewWatchedMs === 'number' && s.previewWatchedMs >= GOOD_DWELL_MS) {
    return { verdict: 'good', reasons: [`the app was used for ${Math.round(s.previewWatchedMs / 60_000)} minute(s) without a complaint`] };
  }

  // Everything else is genuinely unknown. A short look is NOT evidence of a bad app — people glance at
  // something they are happy with and move on, exactly as often as they bounce off something broken.
  return { verdict: 'unclear', reasons: ['no clear signal either way yet'] };
}

/**
 * Should this build's report be sent to the admin automatically, right now?
 *
 * Only a BAD verdict, and only once per build. The once-per-build rule is not tidiness: the signals
 * arrive across several separate requests over minutes, so without it a single unhappy user would
 * generate a report on the complaint, another on the Diagnose press, and another on the next message.
 */
export function shouldAutoReport(verdict: OutcomeVerdict, alreadyReported: boolean): boolean {
  return verdict === 'bad' && !alreadyReported;
}

/**
 * The one line the admin reads first. Says what the user DID, never a bare score — a number with no
 * story behind it is the thing the star rating would have given us, and the reason it was rejected.
 */
export function autoReportReason(j: OutcomeJudgement): string {
  const why = j.reasons.length ? j.reasons.join('; ') : 'no reason recorded';
  return `Sent automatically: the build reported success but ${why}.`;
}
