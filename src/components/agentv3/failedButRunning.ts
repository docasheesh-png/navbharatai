// THE APP RUNS, THE VERDICT SAYS IT DOES NOT — WHAT DO WE PUT IN FRONT OF THE USER?
//
// ADMIN, 2026-09-14, describing what actually happens in production (this is not inferred from a
// report — it is what he watches users do):
//
//   "kabhi kabhi app ban jata hai, par chatbox me ai bolta 'fix with ai' aur woh build fail me count
//    ho jata hai (10-12% time, not always). aur ham aise builds ko fix with ai press hote hi SACH ME
//    TOD DETE HAI. yaha 3 nuksan hai: 1- jo galat failed count hua, uska charge = 0. 2- wapas se wahi
//    sahi app ko build karna padega. 3- user ka trust bhi gaya!!"
//
// THE MECHANISM, end to end:
//   1. A build finishes. The platform opens the app in a real browser and SEES IT RENDER
//      (`GREEN_GUARD_SAVE` — "recorded as the last known good state").
//   2. Something unrelated still marks the verdict `ok: false` — a budget-refused provider call
//      counted as a blocker (#2913), a healed blocker never cleared (#2929/#2931), a release gate
//      summarising a finding that is not about the app at all.
//   3. The chat shows the failure card, and its button sends:
//         "Continue from where you left off and finish/fix the build so the app works end-to-end."
//   4. That sentence ASSERTS, as fact, that the app does not work end-to-end. On an app that does, it
//      is a false premise — and a model handed a false premise does not answer "nothing is wrong". It
//      goes looking, finds nothing, and changes working code until it has something to show for the
//      turn. **That is how we break the app ourselves.**
//
// 🔴 THE 50/50 SPLIT, AND WHY THIS HALF IS THE ONE THAT LASTS. Fixing each cause of a wrong verdict is
// the first half, and it is being done one cause at a time. But the admin's own number is the point:
// it happens 10-12% of the time and it will never be exactly zero. So the durable half is this — even
// when the verdict IS wrong, the user must never be invited to "fix" an app the platform has just
// watched working. The evidence and the invitation must come from the same place.
//
// ⚠️ THIS DOES NOT HIDE A FAILURE, and must never be changed into something that does. The verdict is
// untouched, the build is still not billed, the summary is still shown in full, and the action is
// still offered. What changes is that the card stops telling the user something we have evidence is
// false, and the prompt stops ordering a rebuild of a working app.
//
// PURE — no React, no I/O, so every rule here is unit-testable and cannot lie about what it did.

/** What the build told us, and what we actually saw. */
export interface FailedTurnFacts {
  /** The build's own verdict. */
  ok?: boolean;
  /**
   * Did the platform OPEN this app in a real browser and see it render?
   *
   * Optional on purpose: the Android shell is a BUNDLED app, so a phone can be running last month's
   * client against today's server and vice versa. `undefined` means "this build did not tell us", and
   * an unknown must resolve to today's behaviour — never to a claim that the app is fine.
   */
  appRendered?: boolean;
  /** True while the app is still being built — no card at all. */
  running?: boolean;
  /** A hard error (a crash, a refusal) is a different card and is never this one. */
  hasError?: boolean;
  /** A budget pause has its own calm card and its own Continue. */
  budgetReached?: boolean;
  /** The honest summary the build produced. */
  summary?: string;
}

/**
 * Should the "your app is built and running" card replace the failure card?
 *
 * Every condition is required. In particular `appRendered === true` is checked identically, so a
 * missing field, a null, or a truthy non-boolean cannot open this path.
 */
export function appRanDespiteFailedVerdict(f: FailedTurnFacts | null | undefined): boolean {
  if (!f) return false;
  if (f.ok !== false) return false;
  if (f.appRendered !== true) return false;
  if (f.running === true) return false;
  if (f.hasError === true) return false;
  if (f.budgetReached === true) return false;
  return typeof f.summary === 'string' && f.summary.trim().length > 0;
}

/**
 * THE PROMPT SENT WHEN THE APP IS KNOWN TO RUN.
 *
 * Three things it must do, and each one is here because its absence is what broke apps:
 *   • STATE THE EVIDENCE. The model is told the app was opened and rendered, so it is not left to
 *     infer from "fix the build" that everything is suspect.
 *   • FORBID THE REBUILD. "Do not rebuild, redesign or restructure" is explicit because the failure
 *     mode is not a wrong edit — it is a large, confident, unnecessary one.
 *   • LICENCE TO DO NOTHING. A model with no way to report "there was nothing to fix" will invent
 *     work. Saying so plainly is what makes the empty answer available.
 */
export function fixRemainingIssuePrompt(summary: string): string {
  const note = (summary || '').trim();
  return [
    'My app is already built and RUNNING — it was opened in a browser and it rendered correctly.',
    'Do NOT rebuild, redesign or restructure it, and do not touch anything that already works.',
    '',
    'There is one check that did not pass:',
    note,
    '',
    'Look only at that. If it is a real problem in my app, make the smallest possible change to fix it',
    'and tell me exactly what you changed. If it is not a real problem with my app, change NOTHING and',
    'just tell me so — that is a complete and correct answer, and I would rather have it than an edit.',
  ].join('\n');
}

/**
 * The card's own words. Leads with what is TRUE and checkable (the app runs), then the honest caveat.
 *
 * ⚠️ The order matters and is not decoration: this card exists because the user was being told their
 * working app was broken. Putting the caveat first would keep that impression and change only the
 * wording underneath it.
 */
export function appRunningNoticeText(): string {
  return 'Your app is built and running — I opened it in a browser and it rendered. One check did not pass, so I have not marked this build complete (and you have not been charged for it):';
}
