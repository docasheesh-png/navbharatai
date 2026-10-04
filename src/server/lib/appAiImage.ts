// ONE PICTURE PATH for an app built on NavBharatAI — the published app (`/api/app-ai/image`) and the owner's
// preview (`/api/app-ai/preview-image`) both come here, so "whose key, is it allowed, who pays" is decided
// once (admin 2026-10-04: "user ko saaf saaf bolo ki API keys chahiye … user ko guide kare ki keys kaha
// dalni hai").
//
// Order, and why:
//   1. The prompt is checked (triage + the image word ban) before any key is even looked up.
//   2. The app's picture counters: a published app may make at most APP_IMAGES_PER_DAY a day and one
//      visitor VISITOR_IMAGES_PER_DAY — on the OWNER's key a picture costs our wallet nothing, so a ₹ cap
//      could never bind it, while their provider bill grows with every picture a stranger asks for.
//   3. The owner's image key from the encrypted vault (appImageKeys.ts). None ⇒ an honest refusal that
//      tells the OWNER exactly which keys work, where to get each, and where to paste it; a VISITOR is told
//      only that the picture maker is not set up yet.
//   4. A NavBharatAI API key is checked and charged through the Developer API's own path (apiKeyImage.ts);
//      any other key draws on the owner's provider account and costs NavBharatAI nothing.
//   5. A refused key is reported, never silently replaced by NavBharatAI's engine.

import { loadUserVaultSecrets } from './secrets';
import { triagePrompt, blockMessage } from './promptSafety';
import { scanPollinationsPrompt, POLLINATIONS_BLOCK_MESSAGE } from './pollinationsGuard';
import { appAiUsageStore } from './AppAiUsageStore';
import {
  appImageKeyFromSecrets, drawWithOwnImageKey, ownImageKeyMessage, needsImageKeyMessage,
  VISITOR_IMAGE_UNAVAILABLE, APP_KEYS_PLACE, type AppImageProvider,
} from './appImageKeys';
import { resolveApiKey, imageForApiKey } from './apiKeyImage';
import type { ImagePixels } from './navbharatImageEngine';
import type { GeneratedImage } from './imageGen';

/** Pictures one published app may make a day, and one visitor of it. */
export const APP_IMAGES_PER_DAY = 100;
export const VISITOR_IMAGES_PER_DAY = 10;
/** Pictures the owner's own preview may make a day (one visitor: the owner). */
export const PREVIEW_IMAGES_PER_DAY = 50;
export const MAX_APP_IMAGE_PROMPT = 2_000;

/** The image counter id for an app — separate from its text assistant's ₹ counter. */
export function imageCounterId(appId: string): string {
  return `img_${appId}`;
}

export interface AppImageAsk {
  ownerId: string;
  workspaceId: string;
  prompt: string;
  px: ImagePixels;
  counter: { appId: string; visitor: string; day: string; appLimit: number; visitorLimit: number };
}

export type AppImageAnswer =
  | { ok: true; image: GeneratedImage; via: AppImageProvider }
  /** `owner` is what the app's owner reads; `visitor` is what a stranger on the published app reads. */
  | { ok: false; code: 'needs-key' | 'key-problem' | 'blocked' | 'limit' | 'bad-request'; owner: string; visitor: string };

/** Read the prompt from a request body. PURE. */
export function readAppImagePrompt(body: unknown): { ok: true; prompt: string } | { ok: false; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return { ok: false, message: 'Please describe the picture first.' };
  if (prompt.length > MAX_APP_IMAGE_PROMPT) return { ok: false, message: 'That description is too long. Please shorten it.' };
  return { ok: true, prompt };
}

export async function imageForApp(ask: AppImageAsk): Promise<AppImageAnswer> {
  // 1. The words, before anything else.
  try {
    const triage = triagePrompt(ask.prompt);
    if (triage.verdict === 'block') {
      const m = blockMessage(triage.contentClass, ask.prompt);
      return { ok: false, code: 'blocked', owner: m, visitor: m };
    }
  } catch { /* the word ban below still runs */ }
  if (!scanPollinationsPrompt(ask.prompt).ok) {
    return { ok: false, code: 'blocked', owner: POLLINATIONS_BLOCK_MESSAGE, visitor: POLLINATIONS_BLOCK_MESSAGE };
  }

  // 2. The counters.
  const counted = await appAiUsageStore.callsToday(ask.counter.appId, ask.counter.visitor, ask.counter.day);
  if (counted.appCalls >= ask.counter.appLimit) {
    return { ok: false, code: 'limit', owner: `This app has made today's ${ask.counter.appLimit} pictures. It starts again tomorrow.`, visitor: 'The picture maker has reached today\'s limit. Please try again tomorrow.' };
  }
  if (ask.counter.visitor && counted.visitorCalls >= ask.counter.visitorLimit) {
    return { ok: false, code: 'limit', owner: `Today's ${ask.counter.visitorLimit} pictures for one visitor are used.`, visitor: `You have made today's ${ask.counter.visitorLimit} pictures. Please come back tomorrow.` };
  }
  if (!counted.known) console.warn(`[APP_IMAGE] ${ask.counter.appId}: picture counters unreadable — this one was allowed without a limit check.`);

  // 3. The owner's key.
  let secrets: Record<string, string> = {};
  try { secrets = await loadUserVaultSecrets(ask.ownerId, ask.workspaceId); } catch { secrets = {}; }
  const own = appImageKeyFromSecrets(secrets);
  if (!own) return { ok: false, code: 'needs-key', owner: needsImageKeyMessage(), visitor: VISITOR_IMAGE_UNAVAILABLE };

  // 4. NavBharatAI's own key: the Developer API's checks and charge, on the account that owns the key.
  if (own.provider === 'navbharatai') {
    const auth = await resolveApiKey(own.key);
    if (!auth) {
      return {
        ok: false, code: 'key-problem', visitor: VISITOR_IMAGE_UNAVAILABLE,
        owner: `The NavBharatAI API key saved as NAVBHARATAI_API_KEY is not valid (mistyped or revoked). Make a new one in Home → Other AI → Developer Tools → NavBharatAI API and save it in ${APP_KEYS_PLACE}.`,
      };
    }
    const r = await imageForApiKey(auth, ask.prompt, ask.px, 'app');
    if (!r.ok) {
      return { ok: false, code: r.code === 'content_policy' ? 'blocked' : 'key-problem', owner: r.message, visitor: r.code === 'content_policy' ? r.message : VISITOR_IMAGE_UNAVAILABLE };
    }
    void appAiUsageStore.record(ask.counter.appId, ask.counter.visitor, ask.counter.day, r.chargedInr);
    return { ok: true, image: r.image, via: 'navbharatai' };
  }

  // 5. The owner's provider key — their bill, never our wallet, and never silently swapped for ours.
  const r = await drawWithOwnImageKey(own, ask.prompt, ask.px);
  if (!r.ok) {
    const m = ownImageKeyMessage(own.provider, r.reason);
    return { ok: false, code: r.reason === 'blocked' ? 'blocked' : 'key-problem', owner: m, visitor: r.reason === 'blocked' ? m : VISITOR_IMAGE_UNAVAILABLE };
  }
  void appAiUsageStore.record(ask.counter.appId, ask.counter.visitor, ask.counter.day, 0);
  return { ok: true, image: r.image, via: own.provider };
}
