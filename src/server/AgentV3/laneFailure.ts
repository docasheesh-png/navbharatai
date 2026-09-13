// WHY A LANE FAILED — and what may honestly be said and tried next.
//
// ── THE REPORT THIS EXISTS FOR (admin, 2026-09-13, "Mujhe english automation app banana hai") ────
// A free-tier build spent 4 min 18 s and produced ZERO files. What actually happened:
//
//     4.6s   "Planning the file list…"
//     94.6s  the plan cap (90 s) fired — the lane gave up
//     183s   THE PLAN ARRIVED, CORRECT: a clean five-file manifest
//     244s   the one-shot lane burned 150 s more and also failed
//     257s   the user stopped the build
//
// The model was never the problem. Kimi's answer was right; it took 178 s because the provider was
// degraded (3 timeouts on Kimi, 7 rate-limits out of 8 on GLM). Every lane then failed for the SAME
// external reason, one after another, and each one paid full price to discover it.
//
// 🔴 AND THE USER WAS TOLD THE WRONG THING: "Your app needs our strongest engine to finish cleanly.
// Add credits." That message fires whenever a free build does not deliver, WITHOUT asking why. Here
// it turned our own slow provider into a request for the user's money — which the second and third
// absolute rules both forbid, and which is worse than the failure itself.
//
// ── THE DISTINCTION THE PLATFORM WAS MISSING ─────────────────────────────────────────────────────
// A lane can fail two completely different ways, and almost everything downstream should branch on
// which one it was:
//
//   • PROVIDER-DEGRADED — a timeout, a rate limit, an exhausted fallback chain. The model never got
//     to answer, or answered too late to be used. Nothing about the APP caused this, so a second
//     lane on the same sick provider is not a retry — it is the same failure at full price. And no
//     amount of the user's money makes our provider faster.
//
//   • CONTENT — the model answered and the answer was unusable: a manifest too small, output that
//     would not parse, a file set that cannot build. THIS is where a stronger engine genuinely
//     helps, and the only case where inviting the user to pay for one is honest.
//
// PURE — no clock, no I/O, no env.

export type LaneFailureKind = 'provider-degraded' | 'content' | 'unknown';

/**
 * Signatures of a provider that did not answer, as they appear in the reasons lanes actually record.
 *
 * ⚠️ Matched on the REASON STRING because that is what every lane already produces — adding a typed
 * error class would mean touching each throw site, and the strings are written by us, not by a
 * vendor. They are matched case-insensitively and as substrings, so a provider prefix or a suffixed
 * duration cannot defeat them.
 */
const DEGRADED_MARKERS = [
  'timed out',
  'timeout',
  'did not finish within',
  'rate limit',
  'rate-limit',
  'ratelimit',
  '429',
  'overloaded',
  'capacity',
  'temporarily unavailable',
  'service unavailable',
  'econnreset',
  'etimedout',
  'socket hang up',
  'all providers failed',
  'no provider',
];

/** Answers that came back and were unusable — the model's fault, not the network's. */
const CONTENT_MARKERS = [
  'manifest_too_small',
  'no files',
  'empty',
  'could not parse',
  'unparseable',
  'invalid',
  'nothing parseable',
];

/**
 * Classify a lane's failure reason.
 *
 * ⚠️ ORDER MATTERS AND IS DELIBERATE: degraded is checked FIRST. A reason can carry both ("plan
 * timed out — no files"), and in that pairing the timeout is the cause and the emptiness is its
 * symptom. Reading it the other way round is exactly how a provider outage gets reported to a user
 * as their app being too hard.
 */
export function classifyLaneFailure(reason: string | null | undefined): LaneFailureKind {
  const r = String(reason ?? '').toLowerCase().trim();
  if (!r) return 'unknown';
  if (DEGRADED_MARKERS.some((m) => r.includes(m))) return 'provider-degraded';
  if (CONTENT_MARKERS.some((m) => r.includes(m))) return 'content';
  return 'unknown';
}

/**
 * May ANOTHER generation lane be attempted after this one failed?
 *
 * No, when the provider is degraded. The second lane runs on the same chain that just proved it
 * cannot answer in time; in the report above that cost 150 seconds and produced nothing, on top of
 * the 90 the first lane had already spent. `unknown` stays permissive — a reason we cannot read is
 * not evidence of anything, and refusing on it would silently disable a working path.
 */
export function anotherLaneWorthTrying(reason: string | null | undefined): boolean {
  return classifyLaneFailure(reason) !== 'provider-degraded';
}

/**
 * May we invite the user to add credits for a stronger engine?
 *
 * ONLY when the failure was genuinely about capability. Asking for money because OUR provider timed
 * out is charging for our own outage, and it is the single most damaging thing in the report this
 * module was written from.
 */
export function upsellIsHonest(reason: string | null | undefined): boolean {
  return classifyLaneFailure(reason) === 'content';
}

/**
 * What to tell the user when the provider — not their app — is why nothing was built.
 *
 * White-Label Law: no vendor name, no model id, no hint that more than one provider exists. It
 * names OUR fault, says nothing is lost, and asks for nothing.
 */
export function providerDegradedMessage(): string {
  return (
    'NavBharatAI’s engine is running slowly right now and your build could not finish — ' +
    'this one is on us, not on your app. Nothing you have done is lost. Please try again in a few minutes.'
  );
}
