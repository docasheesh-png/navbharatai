import { formatEta } from '../lib/BuildTimeEstimator';

// TEMPLATE VERIFY JOBS — autopsy 778d7c58 (2026-10-16). A starter chip seeded the finished, tested golden
// template (tier 'simple'), yet the build behaved like a from-scratch app: no preview until the model
// eventually called update_preview (the user stopped at 76s staring at nothing), a 112k-char architect prompt,
// a 3–8 min ETA, and "polish" edits on text the model had never read. Every one of those followed from the
// same root: nothing downstream knew that a seeded finished template is a VERIFY job. These helpers say so
// in one place, for every golden template rather than the Panchang one.

const off = (v: string | undefined): boolean => String(v ?? '').trim().toLowerCase() === 'off';

/** Start the live preview of a seeded template immediately (default ON; AGENTV3_TEMPLATE_INSTANT_PREVIEW=off disables). */
export function templateInstantPreviewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !off(env.AGENTV3_TEMPLATE_INSTANT_PREVIEW);
}

/** A build is verify-only when the seeded scaffold is the finished app (tier 'simple'). */
export function isTemplateVerifyJob(seededTier: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return seededTier === 'simple' && !off(env.AGENTV3_TEMPLATE_VERIFY_MODE);
}

/** Verify jobs always get the slim modular prompt, even with AGENTV3_MODULAR_PROMPT off. */
export function shouldUseSlimPrompt(modularFlagOn: boolean, seededTier: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return modularFlagOn || isTemplateVerifyJob(seededTier, env);
}

export const TEMPLATE_VERIFY_LOW_MS = 45_000;
export const TEMPLATE_VERIFY_HIGH_MS = 150_000;

/**
 * Bound an estimate for a verify job when the workspace has no history of its own. The fleet history it
 * otherwise falls back to is dominated by from-scratch builds, which is how a ~1 min verify was told 3–8 min.
 */
export function capTemplateVerifyEstimate<T extends { estimateMs: number; lowMs: number; highMs: number; etaText?: string }>(est: T, verifyJob: boolean, hasOwnHistory: boolean): T {
  if (!verifyJob || hasOwnHistory) return est;
  const clamp = (n: number) => Math.min(TEMPLATE_VERIFY_HIGH_MS, Math.max(TEMPLATE_VERIFY_LOW_MS, n));
  const estimateMs = Math.min(clamp(est.estimateMs), 75_000);
  return { ...est, ...(est.etaText !== undefined ? { etaText: formatEta(estimateMs) } : {}), estimateMs, lowMs: Math.min(clamp(est.lowMs), estimateMs), highMs: Math.max(clamp(est.highMs), estimateMs) };
}
