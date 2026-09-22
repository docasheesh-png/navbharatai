// The safety triage, applied to an IMAGE request — the surface that had none (2026-09-21).
//
// 🔴 THE GAP, stated plainly because a PR description had already claimed the opposite. `CLAUDE.md`
// records the pornography ban as enforced by `triagePrompt`, "one triage serving BOTH the build route
// and the chat route". It did serve both. It served NEITHER image route: `/api/image/generate` and
// `/api/image/pro/generate` never called it, so the only thing standing between a pornographic
// prompt and a picture was whichever provider happened to refuse — and the free provider's anonymous
// door has safety OFF unless asked for, and since #3234 the browser fetches that link itself. PR #3234
// said "the ban's enforcement is, as before, `triagePrompt` on our server — which this design
// preserves". That sentence was written from the doc, not from the route, and it was false.
//
// So this is the third surface, and it reuses the SAME triage, the SAME record and the SAME refusal
// wording as the other two — a second copy of "what is banned" is how the two would drift.
//
// 🔒 A TRIAGE THAT CANNOT RUN NEVER REFUSES. The chat route's rule, kept: an unavailable checker
// degrades to allow, loudly in the log. The verdict itself is deterministic and costs no model call.
//
// ⚠️ 422 WITH A BRANDED MESSAGE, NOT 200. Chat answers a block as a normal reply because the user is
// looking at a chat bubble; the image screen shows an error card with the words in it, and that card
// is where a refusal belongs. The message names no rule and no pattern (`blockMessage`).

import type { Request } from 'express';
import { triagePrompt, safetyExcerpt, blockMessage, type PromptTriage } from './promptSafety';

export type ImageSafetyOutcome =
  | { blocked: false; triage: PromptTriage }
  | { blocked: true; triage: PromptTriage; message: string };

/**
 * PURE half: the decision and the words, from the user's own request.
 *
 * Words only — an attached picture is not read (we do not classify photographs), and the words that
 * describe what to do to it are exactly the request a triage is for.
 */
export function decideImageSafety(words: string | null | undefined): ImageSafetyOutcome {
  const triage = triagePrompt(words);
  if (triage.verdict === 'block') {
    return { blocked: true, triage, message: blockMessage(triage.contentClass, String(words ?? '')) };
  }
  return { blocked: false, triage };
}

/**
 * The route half: decide, record a flag or a block the way chat and build do, and hand back what to
 * send. Recording never delays or changes the decision; every I/O here is best-effort.
 */
export async function triageImageRequest(req: Request, words: string | null | undefined): Promise<ImageSafetyOutcome> {
  let outcome: ImageSafetyOutcome;
  try {
    outcome = decideImageSafety(words);
  } catch (e) {
    console.error('[IMAGE_GEN] safety triage unavailable — allowing the request:', e);
    return { blocked: false, triage: { verdict: 'allow', ruleId: '', contentClass: 'general', description: '' } };
  }
  if (outcome.triage.verdict === 'allow') return outcome;
  try {
    const { buildSafetyFlag, recordSafetyFlag } = await import('./safetyFlagStore');
    const { verifyFirebaseToken } = await import('./authMiddleware');
    const { audit } = await import('./audit');
    const flaggedUid = (await verifyFirebaseToken(req).catch(() => null)) || 'anon';
    audit(
      outcome.blocked ? 'PROMPT_BLOCKED' : 'PROMPT_FLAGGED',
      { uid: flaggedUid, rule: outcome.triage.ruleId, class: outcome.triage.contentClass, tier: 'image' },
      'warn',
    );
    void recordSafetyFlag(buildSafetyFlag({
      uid: flaggedUid, triage: outcome.triage, surface: 'image', excerpt: safetyExcerpt(words), at: Date.now(),
    })).catch(() => { /* the decision stands either way */ });
  } catch (e) {
    console.error('[IMAGE_GEN] safety flag could not be recorded:', e);
  }
  return outcome;
}
