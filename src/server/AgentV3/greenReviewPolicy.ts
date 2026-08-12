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
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!greenStopEnabled(input.env)) return true; // switched off → today's behaviour, always write
  return !input.previewGreen; // green → suggest, not write
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
    out.push({ title: title.slice(0, 160), detail, functional: it.functional === true || it.critical === true });
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
