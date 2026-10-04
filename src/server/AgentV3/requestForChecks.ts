// AgentV3 — the request the "did we build what was asked?" checks grade against.
//
// 🔴 WHY (autopsy 241215d1, 2026-10-04). The first build of a paper-trading app was stopped after two
// minutes with nothing written. The user pressed "Continue", whose message is our own fixed sentence:
// "Continue from where you left off and finish/fix the build so the app works end-to-end." The builder
// received the earlier request through the conversation recap and built the app. Since e725e002 the
// sizers read it too (`planningRequest`). But every check that compares the app with the request —
// requirement coverage, the feature probe, the claim audit — read the 86-character message, found
// nothing asked for, and graded nothing. A request of 2,100 characters (live yfinance data, four order
// types, risk metrics) was checked against "continue". The same class as e725e002 ("a judge that
// reads less than the worker it judges"), one stage later: the checks at the END of the build.
//
// 🔒 PRECISION FIRST. The earlier request is used only when the message names NOTHING to check on its
// own (`requestedFeatureLabels` is empty) and `planningRequest` already decided the earlier turns still
// describe the app (no finished app exists, or the message points at the conversation). A message with
// its own ask ("add dark mode") is graded on its own words, exactly as before, so an abandoned earlier
// request can never be reported as "not built". Attachments are left out: a document can name far more
// than was asked for, and the checks are keyword-based. PURE.

import type { PlanningRequest } from './planningRequest';

/** The bracketed labels `planningRequest` writes for a model. A word-matcher must never read them. */
const PLANNING_LABEL = /^\[(?:Earlier in this conversation|The message refers to the conversation)[^\n]*\]$/;

/**
 * The text the requirement checks read. `ownFeatureCount` is how many features the message itself names
 * (`requestedFeatureLabels(prompt).length`), passed in so this module stays free of the feature table.
 */
export function requestForChecks(prompt: string, planning: Pick<PlanningRequest, 'text' | 'sources'>, ownFeatureCount: number): string {
  const own = typeof prompt === 'string' ? prompt : '';
  if (ownFeatureCount > 0) return own;
  const sources = Array.isArray(planning?.sources) ? planning.sources : [];
  if (!sources.some((s) => s === 'earlier-requests' || s === 'conversation')) return own;
  const text = typeof planning?.text === 'string' ? planning.text : '';
  // `planningRequest` joins its parts with a blank line; the attachment part is the one led by its own
  // label, so every part that does not begin with an earlier-request or conversation label is dropped
  // except the message itself (the first part).
  const parts = text.split('\n\n');
  const kept: string[] = [own];
  let inRequestPart = false;
  for (const part of parts.slice(1)) {
    const firstLine = part.split('\n', 1)[0].trim();
    if (firstLine.startsWith('[')) inRequestPart = PLANNING_LABEL.test(firstLine);
    if (!inRequestPart) continue;
    const lines = part.split('\n').filter((l) => !PLANNING_LABEL.test(l.trim())).map((l) => l.replace(/^- /, ''));
    const body = lines.join('\n').trim();
    if (body) kept.push(body);
  }
  return kept.length > 1 ? kept.join('\n\n') : own;
}
