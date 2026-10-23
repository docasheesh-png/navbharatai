// UNIFIED CREDIT WALLET — POLICY (pure, no I/O). See docs/UNIFIED_WALLET.md.
//
// ONE wallet (`user_token_wallets/{uid}`, the doc builds, images, Doctor AI and hosting already debit)
// now also pays for NavBharatAI Free chat once the daily free allowance is used up. Nothing here is a
// second money path: the store layer calls the existing hold/release/settle and build debit functions.
//
// Units: 1 credit = ₹1 = 1000 milli-credits = 100 wallet tokens (TOKENS_PER_RUPEE). Every price in this
// file is an INTEGER number of milli-credits and must be a multiple of 10 so it maps to whole tokens
// (paise). No floats ever reach the wallet from here.
import { TOKENS_PER_RUPEE } from '../../../lib/walletPricing';

export const MILLI_PER_CREDIT = 1000;
const MILLI_PER_TOKEN = MILLI_PER_CREDIT / TOKENS_PER_RUPEE; // 10

type Env = Record<string, string | undefined>;
const int = (v: string | undefined, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : d;
};
const num = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : d;
};

const truthy = (v: string | undefined) => v === '1' || v === 'true' || v === 'on';

/**
 * FOUR INDEPENDENT SWITCHES (review 2026-10-23), all default OFF — any one can be turned on alone:
 *   UNIFIED_WALLET_ENABLED          paid chat past the free quota (0.1 credit) + per-minute gate
 *   UNIFIED_WALLET_FREE_LIMIT       signed-in free quota 20 → 25/day (guests stay 5)
 *   UNIFIED_WALLET_MARGIN           real cost × 2.5 (or the number given) for every metered service
 *   UNIFIED_WALLET_IMAGE_COUNTS_TEXT  a delivered free image also uses one daily text message
 */
export function unifiedWalletEnabled(env: Env = process.env): boolean {
  return truthy(env.UNIFIED_WALLET_ENABLED);
}
export function freeLimitEnabled(env: Env = process.env): boolean { return truthy(env.UNIFIED_WALLET_FREE_LIMIT); }
/** Signed-in daily free messages: main's 20, or the owner's 25 (UNIFIED_WALLET_SIGNED_IN_DAILY) when FREE_LIMIT is on. */
export function signedInDailyLimit(env: Env = process.env): number {
  return freeLimitEnabled(env) ? int(env.UNIFIED_WALLET_SIGNED_IN_DAILY, 25, 0, 100_000) : 20;
}

/**
 * EVERY surface that admits Free answers (owner 2026-10-23: "nothing is free beyond the daily allowance").
 * Explicit list so nothing is missed: `withFreeAnswerQuota` REQUIRES a surface (compile-time), and a test
 * asserts every caller in the repo names one from here. All are charged by default once the quota is used;
 * UNIFIED_WALLET_CHARGED_SURFACES can narrow the list.
 *   chat           plain NavBharatAI Chat (both aliases)
 *   professionals  Free professionals incl. Teacher AI chat
 *   exam           Free exam paper generation
 *   repo-analyst   Repo Analyst chat + generate
 */
export const KNOWN_SURFACES = ['chat', 'professionals', 'exam', 'repo-analyst'] as const;
export type ChatSurface = typeof KNOWN_SURFACES[number];
export function chargedSurfaces(env: Env = process.env): ChatSurface[] {
  const raw = (env.UNIFIED_WALLET_CHARGED_SURFACES ?? KNOWN_SURFACES.join(',')).split(',').map((s) => s.trim());
  return KNOWN_SURFACES.filter((s) => raw.includes(s));
}
export function surfaceIsCharged(surface: string | undefined, env: Env = process.env): boolean {
  return !!surface && unifiedWalletEnabled(env) && (chargedSurfaces(env) as string[]).includes(surface);
}

/**
 * Owner decision (2026-10-23): NO subscriptions. Pure pay-and-use: the user recharges the wallet,
 * every paid use (NavBharatAI Chat past the daily allowance, Pro builds, images…) debits the same wallet.
 * Suggested packs ₹20 / ₹50 / ₹100 / ₹500, GST-inclusive, shown as shortcuts only — the EXISTING minimum
 * recharge (from ₹1) is unchanged; this module adds no minimum. Recharging never removes the daily free
 * allowance: the free quota is always consumed first, then the wallet.
 */
export const DEFAULT_RECHARGE_PACKS_INR: readonly number[] = [20, 50, 100, 500];

export interface UnifiedWalletConfig {
  enabled: boolean;
  /** Price of one Free chat message past the allowance. Default 100 milli = 0.1 credit (₹1 = 10 msgs). */
  chatMessageMilli: number;
  guestDailyMessages: number;
  signedInDailyMessages: number;
  /** Pro build margin = unifiedMargin('build') — kept as a field for callers/tests. */
  buildMargin: number;
  perMinuteSignedIn: number;
  perMinuteGuest: number;
  /** Low-balance warning threshold, in credits. */
  lowBalanceCredits: number;
  gstPercent: number;
  /** Suggested recharge packs (₹, GST-inclusive), ascending. Not a minimum. */
  rechargePacksInr: number[];
}

function rechargePacks(raw: string | undefined): number[] {
  const parsed = (raw ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 100_000);
  const packs = parsed.length ? parsed : [...DEFAULT_RECHARGE_PACKS_INR];
  return [...new Set(packs)].sort((x, y) => x - y);
}

export function unifiedWalletConfig(env: Env = process.env): UnifiedWalletConfig {
  const chat = int(env.UNIFIED_WALLET_CHAT_MESSAGE_MILLI, 100, 10, 100_000);
  return {
    enabled: unifiedWalletEnabled(env),
    chatMessageMilli: chat % MILLI_PER_TOKEN === 0 ? chat : 100,
    guestDailyMessages: int(env.UNIFIED_WALLET_GUEST_DAILY, 5, 0, 1000),
    signedInDailyMessages: signedInDailyLimit(env),
    buildMargin: unifiedMargin('build', env),
    perMinuteSignedIn: int(env.UNIFIED_WALLET_PER_MINUTE, 20, 1, 10_000),
    perMinuteGuest: int(env.UNIFIED_WALLET_GUEST_PER_MINUTE, 6, 1, 10_000),
    lowBalanceCredits: int(env.UNIFIED_WALLET_LOW_BALANCE_CREDITS, 5, 0, 100_000),
    gstPercent: int(env.UNIFIED_WALLET_GST_PERCENT, 18, 0, 100),
    rechargePacksInr: rechargePacks(env.UNIFIED_WALLET_RECHARGE_PACKS),
  };
}

export function milliToTokens(milli: number): number {
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli % MILLI_PER_TOKEN !== 0) throw new Error(`Invalid milli-credit amount: ${milli}`);
  return milli / MILLI_PER_TOKEN;
}
/** ₹ for the existing wallet API (which takes ₹). Exact: tokens/100 is a 2-dp value. */
export function milliToInr(milli: number): number { return milliToTokens(milli) / TOKENS_PER_RUPEE; }

/** Daily free-message allowance before the wallet is debited: guest 5, signed-in 25 (config). */
export function dailyAllowance(cfg: UnifiedWalletConfig, who: { signedIn: boolean }): number {
  return who.signedIn ? cfg.signedInDailyMessages : cfg.guestDailyMessages;
}

/**
 * ONE CENTRAL MARGIN (owner 2026-10-23: "asli kharche me 2.5 guna, har jagah"). Price = real cost × margin for
 * every metered service while UNIFIED_WALLET_ENABLED is on. `UNIFIED_WALLET_MARGIN` (default 2.5), optional
 * per-service override `UNIFIED_WALLET_MARGIN_<SERVICE>` (e.g. UNIFIED_WALLET_MARGIN_BUILD=3).
 * Bounds 1–10; anything else falls back so a typo can never bill below cost or wildly above it.
 */
export const DEFAULT_UNIFIED_MARGIN = 2.5;
export type MarginService = 'ai' | 'build' | 'hosting' | 'database' | 'image' | 'apk' | 'voice' | 'vision' | 'search' | 'api';
/** UNIFIED_WALLET_MARGIN: unset/0/off = OFF (main pricing); on/true/1 = 2.5; a number 1.01–10 = that margin. */
export function unifiedMarginEnabled(env: Env = process.env): boolean {
  const v = (env.UNIFIED_WALLET_MARGIN ?? '').trim();
  if (truthy(v)) return true;
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n > 1 && n <= 10;
}
export function unifiedMargin(service: MarginService | string = 'ai', env: Env = process.env): number {
  const v = (env.UNIFIED_WALLET_MARGIN ?? '').trim();
  const base = truthy(v) ? DEFAULT_UNIFIED_MARGIN : num(v || undefined, DEFAULT_UNIFIED_MARGIN, 1.01, 10);
  const key = `UNIFIED_WALLET_MARGIN_${String(service).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return num(env[key], base, 1, 10);
}

/** Fixed-price service, derived: ceil(real cost ₹ × margin) to the paisa, in integer paise. */
export function derivedPricePaise(realCostInr: number, margin: number): number {
  if (!Number.isFinite(realCostInr) || realCostInr <= 0) return 0;
  return Math.ceil(Math.round(realCostInr * margin * 1e6) / 1e4);
}

/** Build bill (USD) when the unified wallet is on: real cost × configured margin. */
export function unifiedBuildBilledUsd(realCostUsd: number, cfg: Pick<UnifiedWalletConfig, 'buildMargin'>): number {
  const c = Number.isFinite(realCostUsd) && realCostUsd > 0 ? realCostUsd : 0;
  return c * cfg.buildMargin;
}

/** GST split of an INCLUSIVE price, in integer paise (base + gst === total, always). */
export function gstBreakdown(priceInrInclGst: number, gstPercent: number): { totalPaise: number; basePaise: number; gstPaise: number } {
  const totalPaise = Math.round(priceInrInclGst * 100);
  const basePaise = Math.round((totalPaise * 100) / (100 + gstPercent));
  return { totalPaise, basePaise, gstPaise: totalPaise - basePaise };
}

/** What each pack shows: GST-inclusive price, its split, and what it buys (credits / Free chat messages). */
export function rechargePackView(cfg: Pick<UnifiedWalletConfig, 'rechargePacksInr' | 'gstPercent' | 'chatMessageMilli'>) {
  return cfg.rechargePacksInr.map((inr) => ({
    priceInrInclGst: inr, ...gstBreakdown(inr, cfg.gstPercent),
    credits: inr, chatMessages: Math.floor((inr * MILLI_PER_CREDIT) / cfg.chatMessageMilli),
  }));
}

export type ReplyLang = 'hi' | 'hinglish' | 'en';
const HINGLISH = /\b(hai|kya|kaise|mujhe|mera|nahi|karo|batao|aap|kitna|kyun|samjhao)\b/i;
export function detectLang(text: unknown): ReplyLang {
  const s = typeof text === 'string' ? text : '';
  if (/[\u0900-\u097F]/.test(s)) return 'hi';
  return HINGLISH.test(s) ? 'hinglish' : 'en';
}

const fmtCredits = (tokens: number) => (Math.max(0, tokens) / TOKENS_PER_RUPEE).toFixed(2);

/** Wallet empty: today's free messages are used and the balance cannot pay for one more. */
export function insufficientBalanceMessage(lang: ReplyLang, cfg: Pick<UnifiedWalletConfig, 'chatMessageMilli'>): string {
  const per = Math.round(MILLI_PER_CREDIT / cfg.chatMessageMilli);
  if (lang === 'hi') return `आज के मुफ़्त messages ख़त्म हो गए हैं और wallet में balance नहीं है। कितने भी रुपये का recharge करें (₹1 = ${per} messages), या रात 12 बजे (IST) के बाद फिर आएँ।`;
  if (lang === 'hinglish') return `Aaj ke free messages khatam ho gaye aur wallet mein balance nahi hai. kitne bhi rupaye ka recharge karein (₹1 = ${per} messages), ya raat 12 baje (IST) ke baad aayein.`;
  return `Today's free messages are used up and your wallet balance is too low. Recharge any amount (₹1 = ${per} messages), or come back after 12:00 AM IST.`;
}

/** Shown alongside a paid reply once the balance falls under the threshold; '' otherwise. */
export function lowBalanceNotice(lang: ReplyLang, balanceTokens: number, cfg: Pick<UnifiedWalletConfig, 'lowBalanceCredits'>): string {
  if (balanceTokens >= cfg.lowBalanceCredits * TOKENS_PER_RUPEE) return '';
  const b = fmtCredits(balanceTokens);
  if (lang === 'hi') return `आपके wallet में सिर्फ़ ${b} credits बचे हैं। NavBharatAI Chat और Pro दोनों इसी wallet से चलते हैं।`;
  if (lang === 'hinglish') return `Aapke wallet mein sirf ${b} credits bache hain. NavBharatAI Chat aur Pro dono isi wallet se chalte hain.`;
  return `Only ${b} credits left in your wallet. NavBharatAI Chat and Pro both use this one wallet.`;
}

export function rateLimitedMessage(lang: ReplyLang): string {
  if (lang === 'hi') return 'आप बहुत तेज़ी से messages भेज रहे हैं। एक मिनट रुककर फिर भेजें।';
  if (lang === 'hinglish') return 'Aap bahut tezi se messages bhej rahe hain. Ek minute rukkar phir bhejein.';
  return 'You are sending messages too quickly. Please wait a minute and try again.';
}
