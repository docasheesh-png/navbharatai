// AgentV3 — GREEN STOP: once the app WORKS, stop silently rewriting it. Offer, do not impose.
//
// THE ADMIN'S OBSERVATION, VERIFIED IN A REAL BUILD (BENCHMARK 0, 2026-08-12): the 3D game rendered in
// the browser at minute 6.6. The build ran to minute 14.3. More than half of it was spent editing an
// app that already worked — and in the 44-minute report before it, the reviewer's silent auto-fix
// replaced the user's real .env secrets with placeholders and killed the app's database and payments.
//
// THE ROOT CAUSE is not any single pass. It is a missing distinction. After a build there are two
// completely different kinds of finding, and the engine treated them the same — it silently edited the
// working app for both:
//
//   • "The app does not do what the USER ASKED."  (a requested feature is missing, a real runtime error)
//     → This is the user's own request. Building it is finishing the job. Keep doing it automatically.
//
//   • "The app could be BETTER by our standards."  (a security nit, a design inconsistency, a refactor,
//     the reviewer's own opinion)
//     → This is OUR opinion about a working app. Silently applying it is exactly how a working app gets
//     re-broken. The admin's own fix: show it, in the user's language, and let them choose.
//
// So the rule is not "stop fixing". It is: once the app is verified GREEN (opened in a real browser and
// genuinely rendered), the engine's OWN OPINIONS become SUGGESTIONS, while the USER's OWN REQUESTS are
// still fulfilled. "user ne jo maanga wo karo; jo humein theek lagta hai wo sirf batao."
//
// This module is the PURE decision half — no I/O, no model, no clock. Every rule is unit-testable and
// cannot lie about what it did. The caller wires two things: (1) skip the reviewer's WRITE pass when
// green, (2) surface its findings as a dismissible "want me to fix these?" offer.

/** Master switch. Default ON — this is the fix the admin asked for. `off` restores the old behaviour. */
export function greenStopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_GREEN_STOP !== 'off';
}

/**
 * Should the REVIEWER's auto-fix WRITE pass run, or should its findings become a suggestion?
 *
 * The reviewer (ReviewerAgent / C9) reports the engine's OWN quality/security/design opinions about the
 * code. When the app is already verified rendering, applying those silently is the re-break class. It
 * writes ONLY when the app is NOT yet green (we are still earning a working app) — or when the whole
 * mechanism is switched off.
 *
 * Deliberately narrow: this governs the REVIEWER, not the requirement/runtime healers. A missing
 * feature the user asked for, and a genuine runtime error, are handled by their own passes and keep
 * fixing automatically — see `userRequestHealAllowedWhenGreen`.
 */
export function reviewerShouldWrite(input: {
  previewGreen: boolean;
  /**
   * Did we OPEN the app and SEE it broken? Not "it is not green" — positively observed as broken.
   *
   * `previewGreen: false` covers two completely different situations, and the original rule treated
   * them the same: (1) we looked and the app was broken, and (2) we never managed to look at all — no
   * sandbox, a snapshot taken before the app painted, a dead dev server. Only the first is a reason to
   * let the reviewer rewrite the code.
   */
  previewProvenBroken?: boolean;
  /** Did the BUILD itself report success? A build that failed has no working app to protect. */
  buildOk?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!greenStopEnabled(input.env)) return true; // switched off → today's behaviour, always write
  if (input.previewGreen) return false;          // proven working → suggest, never rewrite
  // A build that says it FAILED has produced nothing worth protecting, so the reviewer's repair is one
  // of the things still trying to rescue it. Writing here cannot break a working app; there isn't one.
  if (input.buildOk === false) return true;
  // Proven broken with a build that claims success — the reviewer's fix is exactly what this case is
  // for, and there is a real defect to aim it at.
  if (input.previewProvenBroken) return true;
  // EVERYTHING ELSE IS IGNORANCE, AND IGNORANCE IS NOT A LICENCE TO EDIT (admin 2026-08-23).
  //
  // The build says it worked and we could not verify the preview — no sandbox, an unpainted snapshot,
  // a dev server that had stopped. The app in front of the user is very likely FINE, and letting the
  // reviewer rewrite it on no evidence is the same re-break class Green Stop exists to end, surviving
  // in the one state nobody had separated out. PreviewVerify already draws this exact line for the
  // repair passes: an inconclusive snapshot means "do nothing", and a dead server means restart a
  // process, never edit code — a code repair cannot fix a dead process, and paying a model to act as
  // a process supervisor is how one home page took forty-five minutes.
  //
  // The findings are not lost: they become the same offer a green app's findings become.
  return false;
}

/**
 * A pass that fulfils the USER's OWN request keeps running even on a green app — because the app is not
 * finished until it does what was asked. This covers the feature-presence heal (a requested feature is
 * missing) and the runtime-error auto-fix (the app renders but throws). These are NOT the engine's
 * opinion; they are the job.
 *
 * Exists as its own named rule so the distinction is explicit and testable, and so a future pass cannot
 * be mis-filed on the wrong side of the line by accident.
 */
/**
 * 💸 A SUGGESTION COSTS A SUGGESTION'S PRICE (autopsy b6f88a72, 2026-09-18).
 *
 * `reviewerShouldWrite` above already decides that on a proven-green app the reviewer's ONLY possible
 * output is a dismissible suggestion — no repair runs, nothing it says can fail the build. But the
 * reviewer still ran at its full budget and its full step cap: on the Gita build it made 40 calls
 * (`src/App.tsx` read SIX times, `src/index.css` five, each time told "you already have it"),
 * 523,374 input tokens — 34% of the whole build's LLM spend — and returned **zero characters**.
 *
 * So the plan is one rule, reused, never a second "is the app green?" question: exactly when Green
 * Stop makes the review suggest-only, the review is also LEAN — a hard step cap and a small budget.
 * Where the reviewer can WRITE (not green, proven broken, or the build failed) nothing changes at all:
 * full budget, full steps, full powers. That is where it earns its keep and it must not be weakened
 * there. The cut is in TOKENS, never in strictness. PURE.
 */
export const GREEN_REVIEW_MAX_STEPS = 12;

/** Kill switch: `off` makes a green review cost what it always did. Default ON. */
export function greenReviewLeanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_GREEN_REVIEW_LEAN !== 'off';
}

export interface GreenReviewPlan {
  /** `suggest` ⇔ the reviewer cannot write; `full` ⇔ today's review, unchanged. */
  mode: 'full' | 'suggest';
  /** The sub-agent step cap for this review; `undefined` keeps the build's ordinary cap. */
  maxSteps: number | undefined;
}

export function greenReviewPlan(input: {
  previewGreen: boolean;
  previewProvenBroken?: boolean;
  buildOk?: boolean;
  env?: NodeJS.ProcessEnv;
}): GreenReviewPlan {
  const env = input.env ?? process.env;
  const suggestOnly = !reviewerShouldWrite({
    previewGreen: input.previewGreen,
    previewProvenBroken: input.previewProvenBroken,
    buildOk: input.buildOk,
    env,
  });
  if (!suggestOnly || !greenReviewLeanEnabled(env)) return { mode: 'full', maxSteps: undefined };
  return { mode: 'suggest', maxSteps: GREEN_REVIEW_MAX_STEPS };
}

export function userRequestHealAllowedWhenGreen(): boolean {
  return true;
}

/** One improvement the engine could make, framed for the user rather than for a linter. */
export interface ReviewSuggestion {
  /** A short, plain-language title — what it is, not how to fix it. */
  title: string;
  /** The original finding text, for the report / for the follow-up build. */
  detail: string;
  /** True for a functional concern (behaviour), false for a hygiene/style/security nit. Functional
   *  concerns are listed first, because they are the ones a user most wants to know about. */
  functional: boolean;
}

/**
 * Turn the reviewer's raw auto-fix items into user-facing suggestions, most-important first.
 *
 * The reviewer tags findings `[CRITICAL]` / `[WARNING]` and marks functional ones. A user does not
 * think in those terms, so the tags are stripped for display and used only to ORDER the list. Pure.
 */
export function toReviewSuggestions(
  items: ReadonlyArray<{ text: string; functional?: boolean; critical?: boolean }>,
  max = 6,
): ReviewSuggestion[] {
  const clean = (t: string): string =>
    String(t ?? '')
      .replace(/^\s*\[(critical|warning|major|minor|high|low)\]\s*/i, '')
      .replace(/^\s*(critical|warning)\s*:\s*/i, '')
      .trim();
  const out: ReviewSuggestion[] = [];
  for (const it of items || []) {
    const detail = String(it?.text ?? '').trim();
    if (!detail) continue;
    const title = clean(detail);
    if (!title) continue;
    out.push({ title: shortTitle(title), detail, functional: it.functional === true || it.critical === true });
  }
  // Functional first, then hygiene; stable within each group; capped.
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.functional === b.s.functional ? a.i - b.i : a.s.functional ? -1 : 1))
    .map(({ s }) => s)
    .slice(0, Math.max(1, max));
}

/**
 * The line appended to the user-facing done summary when the app is green and the reviewer had opinions.
 *
 * It never says "I fixed" — the whole point is that nothing was silently changed. It says the app is
 * ready, lists what the engine noticed, and invites a one-word follow-up. Plain language, branded as
 * NavBharatAI (white-label law — no vendor/model names), and honest: the app WORKS as it is.
 *
 * Returns '' when there is nothing worth offering, so a clean build ships with no nagging.
 */
/**
 * A title the user reads, cut at a WORD boundary and marked as cut.
 *
 * 🔴 It used to be `title.slice(0, 160)`. Autopsy 31dc61fd shipped exactly 160 characters to a real
 * user, ending mid-phrase — *"…The historical `write-typecheck` errors in the two "* — with no
 * ellipsis, so the sentence simply stopped and there was nothing to say it had been shortened. Under
 * a heading that invites "reply fix these", an unfinished sentence reads as the engine breaking
 * rather than as a summary.
 *
 * The full text is never lost: `detail` carries it, and the card renders that.
 */
const TITLE_MAX = 160;
export function shortTitle(text: string, max = TITLE_MAX): string {
  const t = String(text ?? '').trim();
  if (t.length <= max) return t;
  // Leave room for the ellipsis, then step back to the last word break so a word is never halved.
  const room = Math.max(1, max - 1);
  const cut = t.slice(0, room);
  const lastBreak = cut.lastIndexOf(' ');
  // A single enormous word (a URL, a stack frame) has no break to fall back to — cut it rather than
  // return the whole thing, but still mark it, so "no break found" is not a way to bypass the limit.
  const body = lastBreak > Math.floor(room * 0.5) ? cut.slice(0, lastBreak) : cut;
  return `${body.replace(/[\s,;:.\u2013\u2014-]+$/, '')}…`;
}

export function reviewSuggestionSummary(suggestions: ReadonlyArray<ReviewSuggestion>): string {
  if (!suggestions || suggestions.length === 0) return '';
  const lines = suggestions.map((s, i) => `  ${i + 1}. ${s.title}`);
  return [
    '',
    '✅ Your app is built and working — you can use it right now.',
    '',
    `I also noticed ${suggestions.length === 1 ? 'one thing' : `${suggestions.length} things`} I could improve if you want`,
    '(I left your working app exactly as it is, rather than changing it without asking):',
    ...lines,
    '',
    'Want me to? Just reply "fix these" (or tell me which one) and I\'ll do it.',
  ].join('\n');
}

/**
 * The structured payload for a client that can render an interactive "fix these?" card.
 *
 * Separate from the summary text so a richer UI can offer per-item buttons while the summary keeps the
 * feature working end-to-end for a plain text client TODAY (constitution: real features only — the
 * text path already works, this is the enhancement).
 */
export function reviewSuggestionCard(suggestions: ReadonlyArray<ReviewSuggestion>): {
  kind: 'review_suggestions';
  count: number;
  items: ReviewSuggestion[];
} | null {
  if (!suggestions || suggestions.length === 0) return null;
  return { kind: 'review_suggestions', count: suggestions.length, items: [...suggestions] };
}

/**
 * A REAL BUG IN A WORKING APP GETS ONE VERIFIED REPAIR (admin 2026-09-23, autopsy ac41a924: "han to
 * fix karo"). Green Stop made every reviewer finding on a green app a suggestion. That was right for
 * the engine's OPINIONS and wrong for the reviewer's FUNCTIONAL findings: a news site shipped with
 * every article rendered as one paragraph and footer links into "page not found", because the
 * reviewer that found both could only suggest. The user asked for a working site; a broken one is
 * the job left undone, the same reason the feature heal and the runtime fix may write to a green app.
 *
 * What keeps it from being the 2026-08-12 disaster it replaces the ban on:
 *   • only FUNCTIONAL findings — criticals and `selectAutoFixableWarnings`, never style or a11y polish;
 *   • one pass, with its own abort, bounded by the build's wall clock (see `greenRepairPlan`);
 *   • `verifyAfterFix`: a repair that stops the app rendering is reverted to the green snapshot, and a
 *     repair that runs out of time is stopped AND reverted — an unfinished edit is never kept;
 *   • the pass may never write a `.env` file (greenFreeze.ts `SECRET_FILE_DENIED_PASSES`).
 * `AGENTV3_GREEN_FUNCTIONAL_REPAIR=off` restores suggest-only exactly.
 */
export function greenFunctionalRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_GREEN_FUNCTIONAL_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

/** Time the re-render check needs after the repair (one browse, bounded at 35 s) plus the revert. */
export const GREEN_REPAIR_VERIFY_RESERVE_MS = 40_000;
/** Room after verification for the build's own settle (billing, persist, the terminal result). */
export const GREEN_REPAIR_SETTLE_SLACK_MS = 20_000;
/** Below this there is no honest repair to attempt; the findings stay an offer. */
export const GREEN_REPAIR_MIN_MS = 30_000;
/** Never more than this, however much time is left — it is one focused pass, not a rebuild. */
export const GREEN_REPAIR_MAX_MS = 150_000;

export interface GreenRepairPlan {
  /** How long the repair itself may run. 0 ⇒ do not start — the findings stay an offer. */
  repairMs: number;
  /**
   * The advisory cap to re-arm for this repair, or 0 when it is not attempted. Re-armed ONCE, to a
   * bound computed here — so the cap's promise (no advisory step can hold a finished build open
   * indefinitely) still holds, with a known, finite number instead of the 120 s default.
   */
  capMs: number;
}

/**
 * 🔴 WHY THE BUDGET IS THE BUILD'S TIME AND NOT WHAT THE ADVISORY CAP HAS LEFT. The advisory cap
 * (120 s) is armed BEFORE the reviewer runs, and a green app's reviewer alone may take 45 s — so what
 * the cap has left is routinely ~30 s, less than one turn of a reasoning model. A repair sized to that
 * would almost never start, and one that started would be cut off mid-edit. So the repair is bounded
 * by the BUILD's remaining wall clock (the real ceiling), and the cap is re-armed once to exactly
 * repair + verification + settle. PURE.
 *
 * `buildHeadroomMs` is Infinity when the build has no wall clock.
 */
export function greenRepairPlan(buildHeadroomMs: number): GreenRepairPlan {
  const headroom = Number.isFinite(buildHeadroomMs) ? buildHeadroomMs : Number.POSITIVE_INFINITY;
  if (Number.isNaN(buildHeadroomMs)) return { repairMs: 0, capMs: 0 };
  const usable = headroom - GREEN_REPAIR_VERIFY_RESERVE_MS - GREEN_REPAIR_SETTLE_SLACK_MS;
  if (!(usable >= GREEN_REPAIR_MIN_MS)) return { repairMs: 0, capMs: 0 };
  const repairMs = Math.min(usable, GREEN_REPAIR_MAX_MS);
  return { repairMs, capMs: repairMs + GREEN_REPAIR_VERIFY_RESERVE_MS + GREEN_REPAIR_SETTLE_SLACK_MS };
}

export interface GreenRepairFacts {
  kept: boolean;
  reverted: boolean;
  timedOut: boolean;
  finished: boolean;
  count: number;
  budgetMs: number;
}

/**
 * The honest admin line for the green repair. PURE. Four outcomes, and "undone" is the SUCCESS of the
 * safety net rather than a failure of the app: the user still has the version that rendered.
 */
export function greenRepairOutcome(f: GreenRepairFacts): { severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean } {
  const n = Math.max(0, f.count | 0);
  if (f.kept) {
    return {
      severity: 'info', code: 'REVIEW_FUNCTIONAL_REPAIRED', autoResolved: true,
      message: `${n} functional reviewer finding(s) on the working app were repaired, and the app was re-opened in a real browser and still renders.`,
    };
  }
  if (f.reverted) {
    const why = f.timedOut
      ? `the repair did not finish inside its ${Math.round(f.budgetMs / 1000)} s budget`
      : !f.finished
        ? 'the repair pass did not complete'
        : 'the app could not be shown to still render afterwards';
    return {
      severity: 'info', code: 'REVIEW_FUNCTIONAL_REPAIR_UNDONE', autoResolved: true,
      message: `A repair of ${n} functional reviewer finding(s) was undone because ${why} — the working version was restored, and the findings were offered instead.`,
    };
  }
  return {
    severity: 'warning', code: 'REVIEW_FUNCTIONAL_REPAIR_UNDONE', autoResolved: false,
    message: `A repair of ${n} functional reviewer finding(s) was not kept, and restoring the working version did not complete — check that the app still renders.`,
  };
}

/** The line the USER reads when a green repair was kept. Branded, no engine or vendor named. PURE. */
export function greenRepairUserLine(count: number): string {
  const n = Math.max(0, count | 0);
  if (n === 0) return '';
  return `\n\n🔧 After the app was working, a final review found ${n} real problem${n === 1 ? '' : 's'}. ${n === 1 ? 'It was' : 'They were'} fixed, and the app was checked again: it still works.`;
}
