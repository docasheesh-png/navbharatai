// ONE PICTURE FOR A NAVBHARATAI API KEY — shared by the Developer API's `POST /api/v1/images/generations`
// and by an app whose owner saved a NavBharatAI key as its image key (admin 2026-10-04: "user ko navbhatai
// api keys ka offer den"). One function, so a key cannot buy a picture through one door that another door
// would have refused.
//
// The order is cheap-first and nothing is spent until every check has passed:
//   1. the key carries the "Images" permission (`ai:images`, or full access);
//   2. the request is not banned (the platform triage, recorded like every other surface);
//   3. the key's own daily ₹ limit is not reached;
//   4. the account may start a picture (5 free a day, then the wallet must cover the price);
//   5. NavBharatAI's engines draw it;
//   6. AFTER delivery: counted, charged (imageAllowance), and the ₹ added to the key's daily counter.

import { hasScope, hashApiKey } from './ApiKeyManager';
import { apiKeyStore, type ApiKeyAuth } from './ApiKeyStore';
import { apiKeyUsageStore } from './ApiKeyUsageStore';
import { keyDayKey, normalizeDailyCapInr, refusalMessage } from './developerApi';
import { triagePrompt, safetyExcerpt, blockMessage } from './promptSafety';
import { buildSafetyFlag, recordSafetyFlag } from './safetyFlagStore';
import { audit } from './audit';
import { isAgentV3FreeUser } from '../AgentV3/featureFlag';
import { emailForUid } from './uidEmail';
import { drawWithNavBharat, imageStartFor, chargeDeliveredImage, type ImagePixels } from './navbharatImageEngine';
import type { GeneratedImage } from './imageGen';

export type ApiKeyImageResult =
  | { ok: true; image: GeneratedImage; chargedInr: number; freeLeftToday: number | null }
  | { ok: false; status: number; code: 'missing_scope' | 'content_policy' | 'daily_cap_reached' | 'insufficient_balance' | 'engine_unavailable'; message: string };

export const IMAGES_SCOPE = 'ai:images' as const;

/** Resolve a pasted NavBharatAI key to its account, or null for a wrong / revoked key. Never throws. */
export async function resolveApiKey(plaintext: string): Promise<ApiKeyAuth | null> {
  const key = String(plaintext ?? '').trim();
  if (!key) return null;
  try { return await apiKeyStore.findByHash(hashApiKey(key)); } catch { return null; }
}

export async function imageForApiKey(
  auth: ApiKeyAuth,
  prompt: string,
  px: ImagePixels,
  surface: 'api' | 'app',
  now: number = Date.now(),
): Promise<ApiKeyImageResult> {
  if (!hasScope(auth.scopes, IMAGES_SCOPE)) {
    return {
      ok: false, status: 403, code: 'missing_scope',
      message: 'This NavBharatAI API key does not have the "Images" permission. Edit the key on the Developer Tools page and tick Images.',
    };
  }

  try {
    const triage = triagePrompt(prompt);
    if (triage.verdict !== 'allow') {
      audit(triage.verdict === 'block' ? 'PROMPT_BLOCKED' : 'PROMPT_FLAGGED',
        { uid: auth.userId, rule: triage.ruleId, class: triage.contentClass, tier: surface === 'api' ? 'api' : 'app-image' }, 'warn');
      void recordSafetyFlag(buildSafetyFlag({ uid: auth.userId, triage, surface: 'image', excerpt: safetyExcerpt(prompt), at: now }))
        .catch(() => { /* the decision stands either way */ });
      if (triage.verdict === 'block') {
        return { ok: false, status: 422, code: 'content_policy', message: blockMessage(triage.contentClass, prompt) };
      }
    }
  } catch (e) {
    console.error('[API_IMAGE] safety triage unavailable — allowing the request:', e);
  }

  const day = keyDayKey(now);
  const capInr = normalizeDailyCapInr(auth.dailyCapInr);
  const [spent, email] = await Promise.all([apiKeyUsageStore.spentToday(auth.keyId, day), emailForUid(auth.userId)]);
  if (spent.spentInr >= capInr) {
    return { ok: false, status: 429, code: 'daily_cap_reached', message: refusalMessage('key-cap', capInr) };
  }
  const freeListed = isAgentV3FreeUser(auth.userId, email);
  const start = await imageStartFor(auth.userId, freeListed);
  if (!start.allow) return { ok: false, status: 402, code: 'insufficient_balance', message: start.message };

  const drawn = await drawWithNavBharat(prompt, px);
  if (!drawn.ok) {
    if (drawn.reason === 'blocked') {
      return { ok: false, status: 422, code: 'content_policy', message: 'That description cannot be drawn. Please describe something else.' };
    }
    console.error(`[API_IMAGE] key ${auth.keyId} (${surface}): no engine made the picture — ${drawn.detail}`);
    return { ok: false, status: 503, code: 'engine_unavailable', message: 'NavBharatAI could not make that picture right now. Please try again in a moment.' };
  }
  console.info(`[API_IMAGE] key ${auth.keyId} (${surface}) served by ${drawn.engine}`);
  const charge = await chargeDeliveredImage(auth.userId, freeListed);
  void apiKeyUsageStore.record(auth.keyId, day, charge.chargedInr);
  return { ok: true, image: drawn.image, chargedInr: charge.chargedInr, freeLeftToday: charge.freeLeftToday };
}
