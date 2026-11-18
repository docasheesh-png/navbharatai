// AgentV3 — shared classification of PERMANENT provider failures.
//
// WHY THIS MODULE EXISTS (build report faa98da9, 2026-09-03 — the second report in three days whose
// rootCause was the same dead ladder rung). A failure that says "the model you asked for does not
// exist, or this key may not use it" is different IN KIND from every other provider failure: a 429
// passes, a timeout passes, a 5xx passes — this one never will, because the id is wrong, retired, or
// not on the plan the key belongs to. It is OUR configuration naming a model that cannot answer.
//
// The recognition already existed, in `classifyProviderFailure` (BuildDiagnostics) — but it lived in
// the REPORTING layer only. So the platform could describe the defect perfectly in an admin report
// while the RUNNER, which alone could act on it, had never heard of the class and re-tried the dead
// rung on every single call. Two layers needing one fact is exactly the drift the fourth absolute
// rule says to centralize, so the predicate lives here and both import it.
//
// PURE, dependency-free, and deliberately a leaf module: BuildDiagnostics and the provider chain both
// import it, so it must never import either.

import { isAccountBalanceFailure } from '../lib/providerAccountQuota';

/**
 * Account funding is a permanent credential failure, even when a provider uses HTTP 429 for it.
 * The recognition is shared with every router (`lib/providerAccountQuota.ts`): it reads the status and the error's
 * own codes as well as its words, so GLM's 429 + code 1113 ("余额不足") and OpenAI's `insufficient_quota` code are
 * caught, not read as a rate limit.
 */
export function isProviderBalanceError(reason: unknown): boolean {
  return isAccountBalanceFailure(reason);
}

const FATAL_PROVIDER_PATTERNS: readonly RegExp[] = [
  /\bauthentication_error\b/i,
  /\bpermission_error\b/i,
  /invalid (?:x-)?api[- ]?key/i,
  /api key (?:is )?(?:invalid|expired|revoked|disabled)/i,
  /account (?:is )?(?:disabled|suspended|deactivated)/i,
];

/** Account failures that cannot recover on another call without account-owner intervention. */
export function isFatalProviderError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return isProviderBalanceError(error) || FATAL_PROVIDER_PATTERNS.some((re) => re.test(text));
}

/**
 * A model that CANNOT answer on this account — wrong id, retired, or not on the key's plan.
 *
 * Deliberately matched on the provider's own words rather than a status code, because the same defect
 * is worded differently by every vendor and several never send a distinguishable code:
 *   Moonshot/Kimi : "404 Not found the model kimi-k2.5 or Permission denied"
 *   OpenAI-compat : "The model `x` does not exist or you do not have access to it"
 *   Anthropic     : "model: unknown model" / permission_error
 *   Z.ai/GLM      : "model not found"
 *
 * ⚠️ "Permission denied" is IN this class on purpose, even though it reads like an auth problem. Kimi
 * folds "no such model" and "your key may not use this model" into one sentence and gives us no way to
 * tell them apart — and BOTH answers are permanent for the rung either way, so both call for the same
 * action: stop re-trying this model, keep the rest of the ladder. Treating it as auth instead would be
 * worse than useless: it would bench the provider's HEALTHY rungs on the evidence of its dead one.
 *
 * ⚠️ NARROW BY CONSTRUCTION. A generic 404, a bare 403, or a quota/billing message must NOT land here
 * — those are either transient or already handled as fatal account problems. The phrase must be about
 * a MODEL. PURE.
 */
export function isModelUnavailableError(reason: unknown): boolean {
  const text = (reason instanceof Error ? reason.message : String(reason ?? '')).trim().toLowerCase();
  if (!text) return false;
  return /\bmodel[_ ]?not[_ ]?found\b|not found the model|\bno such model\b|does not exist|unknown model|model.{0,20}(?:unavailable|deprecated|retired)|permission denied/.test(text);
}

import { isRouterOneAccountingRefusal, routerOneRefusalReason } from '../AI/RouterOne/accounting';

/**
 * ONE detail line for a provider fallback, for the ADMIN report: the message, plus — when our own accounting fence
 * refused a Router One call — WHICH fence. The public wording alone made a self-inflicted refusal read as an outage.
 */
export function fallbackDetail(error: unknown, max = 300): string {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const why = routerOneRefusalReason(error);
  return (why ? `${text} · our-accounting-refused:${why}` : text).slice(0, max);
}

/** A refusal by OUR accounting fence is deterministic for the run: the same fence refuses the next call too. */
export function isAccountingRefusalError(error: unknown): boolean {
  return isRouterOneAccountingRefusal(error);
}

