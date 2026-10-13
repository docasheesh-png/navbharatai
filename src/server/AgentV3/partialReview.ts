// AgentV3 — SALVAGE A REVIEW THAT RAN OUT OF TIME, instead of throwing its findings away.
//
// ROOT CAUSE (admin report 2026-09-01, recorded in PROGRESS.md as STILL OPEN and not touched since):
//
//     🥵 Struggle | 291s (38% of the build) after the last model call on a review that timed out
//                  at 194s and whose findings were DISCARDED
//
// The user paid for 46 files of review — tokens spent, minutes spent — and received nothing at all.
// Not "fewer findings": nothing. The build then shipped with `REVIEW_INCOMPLETE`, its completeness net
// down, on exactly the kind of large app that most needs one.
//
// WHY THE TWO EXISTING FIXES COULD NOT HELP, which is the whole reason this module exists:
//   • 2026-07-07 made the budget SIZE-SCALED (a fixed 90s was killing 40-file reviews).
//   • 2026-08-12 added a GRACE window, after a review landed 1.5s past the stopwatch and was binned.
// Both are good, and both move the CLIFF rather than remove it. The budget is a guess about how long
// a review takes, so some review will always land past it — the 2026-09-01 build had 194s of budget
// plus the full 30s of grace and still needed more. Raising the numbers again just buys a slower
// build and a further-away cliff.
//
// THE THING NOBODY USED: the reviewer is a sub-agent on the shared event stream, and it NARRATES its
// findings AS IT WORKS. The 2026-08-12 report shows this in its own timeline — the complete review
// text arrives as an AGENT_STEP event one millisecond before `agent_done`. So the work was never
// unobservable; it was merely unobserved. A timeout can stop us WAITING for the final summary without
// discarding what the reviewer has already said out loud.
//
// PURE — the impure half (subscribing to the stream) stays at the call site, so every rule below is
// unit-testable against real reviewer output.

import { parseReviewOutput, readLabelledFinding, readLeadingTags, type ReviewResult } from './ReviewerAgent';
import { isLiveStatusLine } from '../../lib/liveStatusLine';

/** Reviewer text captured from the live event stream while the review was still running. */
export interface SalvagedReview extends ReviewResult {
  /** Always true — marks a verdict assembled from an unfinished review. Never rendered as complete. */
  partial: true;
}

/**
 * Is there enough here to be worth calling a review?
 *
 * A reviewer that has only announced itself ("## Code Review Report") has told us nothing, and
 * presenting that as a partial review would be noise dressed as a finding. Require at least one real
 * severity-tagged line, which is also the exact shape `parseReviewOutput` knows how to read. PURE.
 */
export function hasSalvageableFindings(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  // An untagged "**1. Bug: …**" finding counts too — the sibling of `readLabelledFinding` (autopsy d798ddd3).
  // 🔴 AND A TAG IN ANY SHAPE (admin 2026-10-11, build 46e2d74b). This gate kept its own copy of the three
  // exact tags, so a review cut off after "- **[BROKEN / CORRECTNESS] `updateGameState` never accelerates
  // the car.**" was thrown away here before the parser that now reads it was ever asked. One reader for
  // both: `readLeadingTags` is the shape `parseReviewOutput` reads.
  return /\[(CRITICAL|WARNING|SUGGESTION)\]/i.test(text)
    || text.split('\n').some((line) => readLabelledFinding(line) !== null || readLeadingTags(line) !== null);
}

/**
 * Build an honest verdict from an unfinished review's own words, or null when there is nothing to say.
 *
 * THREE HONESTY RULES, each of which the codebase has already paid to learn:
 *
 * 1. **A partial review can never FAIL a build** (`passed` is always true). A truncated stream may have
 *    printed a `[CRITICAL]` whose next sentence was going to withdraw it — this reviewer is explicitly
 *    instructed to self-dismiss false positives in the same finding, and deep-test 66ec5c1e shows what
 *    acting on a phantom critical costs: a working, render-verified app failed, and the auto-fix loop
 *    chased it to the wall-clock cap. Evidence we did not let finish is not evidence enough to condemn.
 *
 * 2. **A score is never invented.** `reviewBuild` may infer 85/40 for a COMPLETE review, which is fair
 *    when the reviewer genuinely finished and simply omitted the number. Inferring one here would be
 *    scoring an unfinished inspection. Only a score the reviewer actually printed is carried; otherwise
 *    it stays 0, and the caller renders the findings rather than a number.
 *
 * 3. **The summary says what this is.** It is labelled partial in its own text, so no downstream
 *    surface — chat, report, health card — can present it as a completed review by accident.
 *
 * PURE.
 */
export function salvageReview(text: unknown): SalvagedReview | null {
  if (!hasSalvageableFindings(text)) return null;
  const raw = String(text);
  const issues = parseReviewOutput(raw);
  if (issues.length === 0) return null;
  // Only a score the reviewer actually wrote down (rule 2).
  const m = raw.match(/score[:\s]+(\d+)/i);
  const score = m ? Math.min(100, Math.max(1, parseInt(m[1], 10))) : 0;
  const counts = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    suggestion: issues.filter((i) => i.severity === 'suggestion').length,
  };
  const parts = [
    `${counts.critical} critical`, `${counts.warning} warning`, `${counts.suggestion} suggestion`,
  ];
  return {
    partial: true,
    passed: true, // rule 1 — never fails a build
    score,
    issues,
    summary: `Partial review — the completeness check ran out of time, but had already reported ${parts.join(', ')} finding(s) before it stopped. These are real findings from an UNFINISHED review, so treat them as leads rather than a verdict; nothing here failed the build.`,
  };
}

/**
 * The user-facing line for a salvaged review.
 *
 * Deliberately NOT `formatReview`: that renders nothing when the score is 0 (its "skipped" signal), and
 * a salvaged review usually has no score precisely because it never reached the end. Reusing it would
 * silently drop exactly the findings this module exists to rescue.
 *
 * Names no provider and no model (white-label law) and claims nothing about completeness. PURE.
 */
export function formatPartialReview(review: SalvagedReview, maxIssues = 5): string {
  // 🔴 NO PROMISE WITHOUT A HANDLER (autopsy 9c612cdb, Q-910-D1). This line used to end `Send "review it" for a
  // full pass.` Nothing runs a review on its own: the post-build review needs files written in that turn
  // (`reviewerShouldRun`), and "review it" classifies as chat. The sentence now says only what is true;
  // tests/aPromiseToTheUserHasAHandler.test.ts fails on any follow-up the user is told to send without a handler.
  const head = '📋 Partial review — the deeper completeness check ran out of time, '
    + 'but here is what it had already found. These are leads from an unfinished check, not a verdict.';
  const lines = review.issues.slice(0, Math.max(1, maxIssues)).map((i) =>
    `  ${i.severity === 'critical' ? '🚨' : i.severity === 'warning' ? '⚠️' : '💡'} ${i.message}`);
  const more = review.issues.length > maxIssues ? [`  …and ${review.issues.length - maxIssues} more.`] : [];
  return [head, ...lines, ...more].join('\n');
}

/**
 * What the USER is told when the post-build review produced nothing usable (it timed out and nothing was
 * salvaged, or it errored) — or `null` when they are told nothing.
 *
 * 🔴 AUTOPSY 9c612cdb (Q-910-D1). On a GREEN app the user read *"The deeper completeness review didn't finish in
 * the time it had — send "review it" and I'll run it on its own."* Two things were wrong, and both were the same
 * defect — a user sentence that outlived the decision behind it:
 *   1. The report had already classified exactly this as process-only, "nothing for the user to do"
 *      (REVIEW_SUGGESTIONS_NOT_READY, SignBridge 2026-09-26). That fix changed the report code three lines below
 *      the narration and never reached the narration.
 *   2. Nothing handles "review it". The review runs only on a turn that wrote files (`reviewerShouldRun`), and the
 *      intent classifier reads "review it" as chat. A promised action that is not wired breaks the second
 *      absolute rule.
 *
 * So: a suggest-only review (the app is proven green; whatever it said was an offer) → nothing at all. A review
 * that could have repaired → one true sentence that names no command. PURE.
 */
export function reviewNotReadyUserLine(o: { suggestOnly: boolean; timedOut: boolean }): string | null {
  if (o.suggestOnly) return null;
  return o.timedOut
    ? '📋 Your app is built and saved. The final completeness check did not finish in the time it had, so it was not applied this time.'
    : '📋 Your app is built and saved (the post-build review could not run this time).';
}

/**
 * WHAT THE REVIEWER HAS SAID SO FAR — from EVERY channel its words reach the stream through (autopsy 9c612cdb,
 * Q-910-D3).
 *
 * 🔴 THE NET THAT A LATER FIX SWITCHED OFF. The "listen while it works" salvage (admin report 2026-09-01) heard
 * only `narration` and `agent_done` from the reviewer — right for the multi-step reviewer it was built for,
 * which narrated between tool steps. On 2026-09-30 (autopsy bee95692) a suggest-only review became ONE call
 * with no tools. A single turn narrates only when it RETURNS, which is exactly what a call cut off by its
 * budget never does; its answer arrives meanwhile as `stream_delta` text, and nobody collected it. So in
 * one-call mode `salvageReview` was unreachable by construction, and a review that had already written
 * "[WARNING] [BROKEN] …" lines was conceded as REVIEW_SUGGESTIONS_NOT_READY.
 *
 * The rules, each one a way the old buffer was wrong or could become wrong:
 *   • a turn's streamed text is joined, in order, under that turn's id;
 *   • when the same turn later narrates its final text, that REPLACES the streamed copy — never both;
 *   • an `agent_done` summary that repeats words already held is not added again;
 *   • live status (the working clock "⏳ Still working — 12s so far", the ETA line) is not the reviewer's words — dropped;
 *   • reasoning deltas (`kind: 'thinking'`) are not its answer — dropped.
 *
 * PURE — the subscription stays at the call site; this only decides what an event adds.
 */
export interface ReviewerWords {
  /** Feed one stream event. Anything that is not this agent's own words is ignored. */
  take(event: unknown): void;
  /** Each segment the reviewer said, in the order it began (for one-line readers). */
  lines(): string[];
  /** All of it, for `salvageReview`. */
  text(): string;
}

export function collectReviewerWords(agent = 'reviewer'): ReviewerWords {
  const segments: Array<{ text: string }> = [];
  const byKey = new Map<string, { text: string }>();
  let said = 0;
  const segmentFor = (key: string): { text: string } => {
    let seg = byKey.get(key);
    if (!seg) { seg = { text: '' }; byKey.set(key, seg); segments.push(seg); }
    return seg;
  };
  const held = (): string[] => segments.map((s) => s.text).filter((t) => t.trim() !== '');
  return {
    take(event: unknown): void {
      if (!event || typeof event !== 'object') return;
      const e = event as { type?: unknown; agent?: unknown; id?: unknown; kind?: unknown; delta?: unknown; text?: unknown; summary?: unknown };
      if (e.agent !== agent) return;
      if (e.type === 'stream_delta') {
        if ((e.kind ?? 'text') !== 'text' || typeof e.delta !== 'string' || typeof e.id !== 'string' || !e.id) return;
        segmentFor(`turn:${e.id}`).text += e.delta;
      } else if (e.type === 'narration') {
        if (typeof e.text !== 'string') return;
        // Live status (the working clock, the ETA line) is not the reviewer's words — read by id, the one
        // shared recogniser (src/lib/liveStatusLine.ts, autopsy 303e8a6f), never by its first character.
        if (isLiveStatusLine({ id: typeof e.id === 'string' ? e.id : null, text: e.text })) return;
        // The turn's final text replaces its streamed copy (same id) — the same words are never held twice.
        if (typeof e.id === 'string' && e.id) segmentFor(`turn:${e.id}`).text = e.text;
        else segmentFor(`said:${said++}`).text = e.text;
      } else if (e.type === 'agent_done') {
        if (typeof e.summary !== 'string' || !e.summary.trim()) return;
        const summary = e.summary.trim();
        if (segments.some((s) => s.text.includes(summary))) return;
        segmentFor(`said:${said++}`).text = e.summary;
      }
    },
    lines: held,
    text: () => held().join('\n'),
  };
}
