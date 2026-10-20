import { formatEta } from '../lib/BuildTimeEstimator';
import { chipExtensionFor, goldenScaffoldForPrompt } from './goldenScaffolds/registry';
import { findSyntaxErrors } from './SyntaxCheck';

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

/**
 * Q-963 option A. A verbatim starter chip (the whole prompt IS the chip, no words added) whose simple
 * template was actually seeded is already the finished app. Default ON. `AGENTV3_TEMPLATE_NO_MODEL=off`
 * restores the model loop. A customised chip, a pro foundation, and a seed that did not land all stay
 * on the loop. PURE.
 */
export function verbatimTemplateSkipsModel(input: {
  preseeded: boolean;
  tier: string | null;
  prompt: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = input.env ?? process.env;
  if (off(env.AGENTV3_TEMPLATE_NO_MODEL)) return false;
  if (!input.preseeded || input.tier !== 'simple') return false;
  // A chip the user added words to is a customisation, not a delivery. An exact chip (or its bare
  // name) is. A prompt that merely fails to contain a chip is not one.
  if (chipExtensionFor(input.prompt)) return false;
  return goldenScaffoldForPrompt(input.prompt)?.tier === 'simple';
}

export interface TemplateSettle {
  deliver: boolean;
  summary: string;
}

const PREVIEW_WAIT_MS = 20_000;

/** Await the preview only when it is enabled, and never longer than PREVIEW_WAIT_MS. */
export function startTemplatePreview(enabled: boolean, run: () => Promise<void>): Promise<void> {
  if (!enabled) return Promise.resolve();
  return Promise.race([
    run().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, PREVIEW_WAIT_MS)),
  ]);
}

/**
 * Seed is already on disk. If it parses, deliver it and do not call a model. If it does not parse,
 * say so and let the existing loop build — a broken template is not "done". Never throws.
 */
export async function settleVerbatimTemplate(input: {
  skip: boolean;
  files: Record<string, string>;
  startPreview: () => Promise<void>;
  narrate: (text: string) => void;
  record: (row: { severity: 'info' | 'warning'; code: string; message: string }) => void;
}): Promise<TemplateSettle> {
  if (!input.skip) return { deliver: false, summary: '' };
  try {
    const errors = await findSyntaxErrors(input.files);
    if (errors.length > 0) {
      const message = `The tested template did not parse (${errors.length} file(s): ${errors.slice(0, 4).map((e) => e.path).join(', ')}) — the engine will build it instead of shipping a file that cannot run.`;
      input.narrate(message);
      input.record({ severity: 'info', code: 'GOLDEN_SCAFFOLD', message });
      return { deliver: false, summary: '' };
    }
    await input.startPreview();
    const summary = 'Your app is NavBharatAI\'s tested template for this request. It is already on the preview — nothing else was generated.';
    input.narrate(summary);
    input.record({ severity: 'info', code: 'GOLDEN_SCAFFOLD', message: summary });
    return { deliver: true, summary };
  } catch (err) {
    const message = `The template could not be checked (${String((err as Error)?.message ?? err).slice(0, 160)}) — the engine will build it.`;
    try { input.record({ severity: 'info', code: 'GOLDEN_SCAFFOLD', message }); } catch { /* the caller owns the recorder */ }
    return { deliver: false, summary: '' };
  }
}

/** The run result a delivered template stands in for, or the result the lanes already produced. */
export function templateRunResult<T>(existing: T | undefined, settled: TemplateSettle): T | undefined {
  if (!settled.deliver || existing) return existing;
  return {
    ok: true,
    summary: settled.summary,
    steps: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, measured: true },
    billedUsd: 0,
  } as T;
}

/** A delivered template already passed its check, so the post-build model gates stand down. */
export function templateCountsAsGated(already: boolean, deliver: boolean): boolean {
  return already || deliver;
}
