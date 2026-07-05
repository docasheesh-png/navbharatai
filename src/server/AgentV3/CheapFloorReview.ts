// AgentV3 — cheap-floor review pipeline policy (admin plan, 2026-07-05).
//
// The flow the admin specified:
//   GLM/KIMI builds → GROK reviews → pass? keep it
//                                  → fail? GLM/KIMI self-repairs ONCE → GROK re-reviews
//                                        → pass? keep it
//                                        → still fail? SONNET repairs it.
//
// Two goals: (1) the weak cheap model (GLM/KIMI) gets EXACTLY ONE self-fix bounce before we spend the
// strong model — "GLM/KIMI ko bas 1 baar wapas bhejo" (no more of the 51-fallback grind). (2) the
// REVIEWER is Grok — cheaper than Sonnet and an independent model family (less correlated blind spots)
// — so Claude/Sonnet is touched ONLY for the final repair, minimising the Anthropic bill.
//
// This module is the PURE, unit-testable policy: the next-action decision + reviewer selection + the
// bounce cap. The model I/O (the Grok/Sonnet call itself) is injected by the route.

/** Default self-repair bounces the cheap floor (GLM/KIMI) gets before the strong model (Sonnet) takes over. */
export const MAX_CHEAP_BOUNCES = 1;

export type ReviewAction = 'accept' | 'cheap_repair' | 'sonnet_repair';

/**
 * Given the latest review verdict (pass) and how many cheap-floor self-repairs have ALREADY run,
 * decide the next action: accept the build, let GLM/KIMI self-repair once more, or escalate to a
 * Sonnet repair. This is what bounds the loop — after `maxBounces` cheap repairs it can only ever go
 * to Sonnet, never bounce to the weak model again. Pure + unit-testable.
 */
export function nextReviewAction(pass: boolean, cheapBouncesUsed: number, maxBounces: number = MAX_CHEAP_BOUNCES): ReviewAction {
  if (pass) return 'accept';
  if (cheapBouncesUsed < maxBounces) return 'cheap_repair';
  return 'sonnet_repair';
}

/**
 * Which model reviews the cheap build. GROK by default (cheaper + an independent family) when a
 * Grok/xAI key is present; falls back to SONNET when `AGENTV3_REVIEWER=sonnet` OR no Grok key is
 * configured — so an unconfigured env is byte-for-byte today's Sonnet-judge behaviour, and a Grok
 * outage degrades safely instead of blocking the build. Pure.
 */
export function selectReviewer(env: { reviewer?: string; grokKey?: string }): 'grok' | 'sonnet' {
  if ((env.reviewer || '').trim().toLowerCase() === 'sonnet') return 'sonnet';
  if ((env.grokKey || '').trim()) return 'grok';
  return 'sonnet'; // no Grok key → safe fallback to today's judge (reviewer outage must never break a build)
}

/** The cheap-floor self-repair bounce cap, env-overridable (AGENTV3_CHEAP_BOUNCES), clamped to [0,3]. Pure. */
export function cheapBounceCap(envVal: string | undefined): number {
  const n = parseInt(envVal || '', 10);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : MAX_CHEAP_BOUNCES;
}
