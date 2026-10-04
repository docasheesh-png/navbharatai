// NAVBHARATAI'S OWN IMAGE ENGINE, FOR SOMEBODY ELSE'S CALLER — an app built on NavBharatAI, or a
// developer holding a NavBharatAI API key (admin 2026-10-04).
//
// Admin, verbatim, when the free image provider stopped answering without a key: "user ko saaf saaf bolo
// ki API keys chahiye. user ko navbhatai api keys ka offer den, aur bhi api keys ke bare me bataye jaise
// grok, gemini, chatgpt". A NavBharatAI API key is one of those keys, so it needs a picture to stand
// behind it. This module is that picture: our engines, our accounts, and the user's ONE wallet.
//
// 🔒 ONE PRICE FOR EVERY DOOR. The charge is exactly the Image Generator's (imageAllowance.ts): five free
// pictures a day per ACCOUNT (India's day), then the admin's fixed price each. A picture is counted and
// charged only AFTER it was delivered, from the count after it, so two at once cannot both be the free
// fifth. A picture that failed costs nothing.
//
// 🔒 AN IMAGE MODEL DRAWS, IT DOES NOT REFUSE. Every prompt passes the platform's word ban
// (scanPollinationsPrompt) before any engine is called, the same as the Image Generator's paid ladder.
// The pornography triage is the caller's (it records flags against a request); this module refuses the
// words again because it is the one place every engine is reached from.
//
// The ladder is the Image Generator's PAID ladder, minus the rungs that need an SDK or a second product:
// FLUX on Cloudflare (1024×1024 only) → the free provider WITH our account key → Grok. Each is skipped
// when its key is not configured, so with none of them the answer is an honest failure, never a guess.

import { cloudflareImageConfig, cloudflareServesSize, fetchCloudflareImage } from './cloudflareImage';
import { fetchPollinationsImage, pollinationsApiKey, grokImageKey, grokImageModel, parseGrokImageResponse, type GeneratedImage } from './imageGen';
import { scanPollinationsPrompt } from './pollinationsGuard';
import { imagePricingEnabled, imageFreePerDay, imagePriceInr, decideImageStart, needsBalance, imageFeeForCount, freeImagesLeft } from './imageAllowance';
import { toolUsageStore } from '../tools/ToolUsageStore';
import { readWalletBalanceInr, firestoreWalletReader } from '../AgentV3/WalletBalance';
import { debitWalletRolledUp } from './walletDebit';
import { featureLabel, featureRollupRef } from './walletFeature';
import { getServerDb } from './serverDb';

export interface ImagePixels { w: number; h: number }

export type DrawResult =
  | { ok: true; image: GeneratedImage; engine: string }
  | { ok: false; reason: 'blocked' | 'failed'; detail: string };

/** The largest side an app may ask for, and the smallest. Outside it the request is clamped. */
export const APP_IMAGE_MAX_SIDE = 1536;
export const APP_IMAGE_MIN_SIDE = 256;

/** Clamp a requested size to something every engine accepts. PURE. */
export function clampImagePixels(width: unknown, height: unknown): ImagePixels {
  const side = (v: unknown) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return 1024;
    return Math.min(APP_IMAGE_MAX_SIDE, Math.max(APP_IMAGE_MIN_SIDE, n));
  };
  return { w: side(width), h: side(height) };
}

/** Which shape a size is — the engines that take a shape rather than pixels read this. PURE. */
export function imageShapeOf(px: ImagePixels): 'square' | 'wide' | 'portrait' {
  if (px.w > px.h * 1.15) return 'wide';
  if (px.h > px.w * 1.15) return 'portrait';
  return 'square';
}

/** Make one picture on NavBharatAI's own engines. No charge here — see `chargeDeliveredImage`. */
export async function drawWithNavBharat(
  prompt: string,
  px: ImagePixels,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<DrawResult> {
  const env = opts.env ?? process.env;
  if (!scanPollinationsPrompt(prompt).ok) return { ok: false, reason: 'blocked', detail: 'word ban' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const tried: string[] = [];

  if (cloudflareImageConfig(env) && cloudflareServesSize(px)) {
    try {
      const r = await fetchCloudflareImage(prompt, { env, fetchImpl, timeoutMs });
      if (r.image) return { ok: true, image: r.image, engine: 'cloudflare-flux' };
      tried.push(`cloudflare: ${r.error ?? 'no image'}`);
    } catch (e) {
      tried.push(`cloudflare: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
    }
  }

  if (pollinationsApiKey(env)) {
    const r = await fetchPollinationsImage(prompt, undefined, { env, fetchImpl, timeoutMs, custom: { width: px.w, height: px.h } });
    if (r.image) return { ok: true, image: r.image, engine: 'free-provider (keyed)' };
    if (r.blocked) return { ok: false, reason: 'blocked', detail: 'word ban' };
    tried.push(`pollinations: ${r.error ?? (r.disabled ? 'disabled' : 'no image')}`);
  }

  const gKey = grokImageKey(env);
  if (gKey) {
    const model = grokImageModel(env);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gKey}` },
        body: JSON.stringify({ model, prompt, n: 1, response_format: 'b64_json' }),
      });
      const data: unknown = await r.json().catch(() => null);
      const img = r.ok ? parseGrokImageResponse(data) : null;
      if (img) return { ok: true, image: img, engine: `grok:${model}` };
      tried.push(`grok: ${r.ok ? 'no image' : `HTTP ${r.status}`}`);
    } catch (e) {
      tried.push(`grok: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: 'failed', detail: tried.join(' | ') || 'no image engine is configured' };
}

/** Can this account start one more picture? Read BEFORE any engine is called. Never throws. */
export async function imageStartFor(uid: string, freeListed: boolean): Promise<{ allow: true } | { allow: false; message: string }> {
  if (!imagePricingEnabled() || freeListed) return { allow: true };
  try {
    const freePerDay = imageFreePerDay();
    const priceInr = imagePriceInr();
    const usedToday = await toolUsageStore.getTodayCount(uid, 'image');
    const facts = { freeListed, usedToday, freePerDay, priceInr };
    const balanceInr = needsBalance(facts)
      ? await readWalletBalanceInr(firestoreWalletReader(getServerDb() as any), uid).catch(() => null)
      : null;
    const start = decideImageStart({ ...facts, balanceInr });
    if (start.allow) return { allow: true };
    return { allow: false, message: `Today's ${freePerDay} free pictures are used, and the NavBharatAI wallet needs at least ₹${priceInr} for the next one. Add balance in the NavBharatAI app.` };
  } catch {
    // An unreadable count or balance is let through, like every wallet gate on the platform.
    return { allow: true };
  }
}

/**
 * Count and charge one DELIVERED picture to `uid`. Returns the rupees charged (0 for a free one).
 * Fire-and-forget safe: a money-path failure is logged, never thrown, so it cannot cost the caller the
 * picture they already have.
 */
export async function chargeDeliveredImage(uid: string, freeListed: boolean): Promise<{ chargedInr: number; freeLeftToday: number | null }> {
  if (!imagePricingEnabled() || freeListed || !uid) return { chargedInr: 0, freeLeftToday: null };
  const freePerDay = imageFreePerDay();
  const countAfter = await toolUsageStore.increment(uid, 'image').catch(() => 0);
  const fee = imageFeeForCount(countAfter, freePerDay, imagePriceInr());
  if (fee > 0) {
    const now = Date.now();
    await debitWalletRolledUp(getServerDb() as any, uid, {
      billedInr: fee,
      rollupRef: featureRollupRef('image', now),
      description: featureLabel('image'),
      feature: 'image',
    }).then((r) => {
      if (!r.ok) console.error(`[IMAGE_ENGINE] ₹${fee} image charge FAILED for ${uid}: ${r.error} — the picture was served but not charged.`);
    }).catch(() => undefined);
  }
  return { chargedInr: fee, freeLeftToday: countAfter > 0 ? freeImagesLeft(countAfter, freePerDay) : null };
}
